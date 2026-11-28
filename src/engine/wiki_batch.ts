import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { buildArchivedDocument, buildReopenedDocument } from "./archive.js";
import { CanonicalPageConflictError, findCanonicalPageConflict } from "./canonical.js";
import { refreshFolderOverviews } from "./folder_overview.js";
import {
  isValidIsoDate,
  parseFrontmatter,
  upsertFrontmatterFields,
} from "./frontmatter.js";
import { rewriteWikiPathLinks, type PathRewrite } from "./link_rewriter.js";
import { normalizeWikiContent, type ExtractedReferenceEntry } from "./ref_sections.js";
import { applyTextEdits, TextPatchError, type TextEdit } from "./text_patch.js";
import {
  folderPathFromWikiRelPath,
  isValidConfidence,
  isValidExperienceKind,
  isValidExperienceStatus,
  isValidPageType,
  isWikiSystemPath,
  RESERVED_TOP_LEVEL_WIKI_PAGES,
  resolvePageType,
  validateOptionalFolderPath,
  validateWikiWritePath,
} from "./wiki_org.js";
import {
  buildPageChunks,
  rebuildReferences,
  storeReferenceEntries,
} from "../ingest/dbapply.js";
import type { Store } from "../store/interfaces.js";
import { syncDocumentMetaFromContent } from "../store/postgres/doc_meta.js";
import type { Document, PageWrite, RevisionOperation } from "../store/types.js";

export const MAX_BATCH_OPS = 100;
export const MAX_BATCH_GET = 100;

export class BatchOperationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly opIndex?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BatchOperationError";
  }
}

export type BatchDocOp =
  | {
      op: "create";
      path: string;
      filename: string;
      content?: string;
      title?: string;
      tags?: string[];
      page_type?: string;
    }
  | {
      op: "replace";
      id?: string;
      path?: string;
      content: string;
      expected_version?: number;
      expected_content_hash?: string;
    }
  | {
      op: "patch";
      id?: string;
      path?: string;
      edits: TextEdit[];
      expected_version?: number;
      expected_content_hash?: string;
    }
  | {
      op: "update_meta";
      id?: string;
      path?: string;
      title?: string;
      tags?: string[];
      date?: string;
      metadata?: string;
      page_type?: string;
      confidence?: string;
      page_status?: string;
      experience_kind?: string;
      last_verified?: string;
      review_after?: string;
      aliases?: string[];
      symptoms?: string[];
      expected_version?: number;
      expected_content_hash?: string;
    }
  | {
      op: "move";
      id?: string;
      path?: string;
      target_folder: string;
      filename?: string;
      expected_version?: number;
      expected_content_hash?: string;
    }
  | {
      op: "archive";
      id?: string;
      path?: string;
      reason: string;
      superseded_by?: string;
      date?: string;
      expected_version?: number;
      expected_content_hash?: string;
    }
  | {
      op: "reopen";
      id?: string;
      path?: string;
      reason?: string;
      confidence?: string;
      last_verified?: string;
      review_after?: string;
      date?: string;
      expected_version?: number;
      expected_content_hash?: string;
    }
  | {
      op: "delete";
      id?: string;
      path?: string;
      expected_version?: number;
      expected_content_hash?: string;
    };

export interface BatchExecuteResult {
  dry_run: boolean;
  ok: true;
  change_set_id?: string;
  op_count: number;
  affected_pages: number;
  rewritten_link_pages: string[];
  results: Array<{
    op_index: number;
    op: BatchDocOp["op"];
    document_id: string;
    relative_path: string;
    old_relative_path?: string;
  }>;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isSystemDocPath(relPath: string): boolean {
  return RESERVED_TOP_LEVEL_WIKI_PAGES.has(relPath) || isWikiSystemPath(relPath);
}

function normalizeWikiInputPath(raw: string): string {
  return raw.trim().replace(/^\/+/, "");
}

function assertOptimisticLock(
  doc: Document,
  expectedVersion: number | undefined,
  expectedHash: string | undefined,
  opIndex: number,
): void {
  if (expectedVersion !== undefined && doc.version !== expectedVersion) {
    throw new BatchOperationError(
      409,
      "VERSION_CONFLICT",
      `op[${opIndex}] version conflict: expected ${expectedVersion}, current ${doc.version}`,
      opIndex,
      { current_version: doc.version, current_content_hash: doc.content_hash, document_id: doc.id },
    );
  }
  const cleanHash = (expectedHash ?? "").trim();
  if (cleanHash && doc.content_hash !== cleanHash) {
    throw new BatchOperationError(
      409,
      "VERSION_CONFLICT",
      `op[${opIndex}] content_hash conflict`,
      opIndex,
      { current_version: doc.version, current_content_hash: doc.content_hash, document_id: doc.id },
    );
  }
}

async function resolveTargetDoc(
  db: Store,
  snapshotById: Map<string, Document>,
  snapshotByPath: Map<string, Document>,
  deletedIds: Set<string>,
  ref: { id?: string; path?: string },
  opIndex: number,
): Promise<Document> {
  const id = (ref.id ?? "").trim();
  const rawPath = normalizeWikiInputPath(ref.path ?? "");
  if (!id && !rawPath) {
    throw new BatchOperationError(400, "BATCH_VALIDATION_ERROR", `op[${opIndex}] requires id or path`, opIndex);
  }

  let doc: Document | null = null;
  if (id) {
    if (deletedIds.has(id)) {
      throw new BatchOperationError(404, "DOCUMENT_NOT_FOUND", `op[${opIndex}] document already deleted: ${id}`, opIndex);
    }
    doc = snapshotById.get(id) ?? (await db.getDocument(id));
  }
  if (!doc && rawPath) {
    doc = snapshotByPath.get(rawPath) ?? (await db.getDocumentByRelativePath(rawPath));
    if (!doc && !rawPath.startsWith("wiki/")) {
      doc = snapshotByPath.get(`wiki/${rawPath}`) ?? (await db.getDocumentByRelativePath(`wiki/${rawPath}`));
    }
  }
  if (!doc || deletedIds.has(doc.id)) {
    throw new BatchOperationError(
      404,
      "DOCUMENT_NOT_FOUND",
      `op[${opIndex}] document not found: ${id || rawPath}`,
      opIndex,
    );
  }
  const clone: Document = { ...doc, tags: [...(doc.tags ?? [])] };
  snapshotById.set(clone.id, clone);
  snapshotByPath.set(clone.relative_path, clone);
  return clone;
}

export async function executeWikiBatch(
  db: Store,
  input: { ops?: BatchDocOp[]; summary?: string; dry_run?: boolean },
  actor = "api",
): Promise<BatchExecuteResult> {
  const ops = input.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new BatchOperationError(400, "BATCH_VALIDATION_ERROR", "ops must be a non-empty array");
  }
  if (ops.length > MAX_BATCH_OPS) {
    throw new BatchOperationError(
      400,
      "BATCH_LIMIT_EXCEEDED",
      `batch ops count ${ops.length} exceeds maximum ${MAX_BATCH_OPS}`,
    );
  }

  const snapshotById = new Map<string, Document>();
  const snapshotByPath = new Map<string, Document>();
  const deletedIds = new Set<string>();
  const deletedPaths = new Set<string>();
  const staged = new Map<
    string,
    { doc: Document | null; relPath: string; operation: RevisionOperation; oldRelPath?: string }
  >();
  const rewrites: PathRewrite[] = [];
  const results: BatchExecuteResult["results"] = [];
  const affectedFolders = new Set<string>();

  for (let i = 0; i < ops.length; i += 1) {
    const item = ops[i];
    if (!item || typeof item !== "object" || typeof item.op !== "string") {
      throw new BatchOperationError(400, "BATCH_VALIDATION_ERROR", `invalid op at index ${i}`, i);
    }

    switch (item.op) {
      case "create": {
        if (!item.filename || !item.filename.trim()) {
          throw new BatchOperationError(400, "BATCH_VALIDATION_ERROR", `op[${i}] create requires filename`, i);
        }
        const relPath = path.posix.join("/", item.path ?? "", item.filename).replace(/^\/+/, "");
        const sourceKind = relPath.startsWith("wiki/") ? "wiki" : "source";
        if (sourceKind === "wiki") {
          try {
            validateWikiWritePath(relPath);
          } catch (err) {
            throw new BatchOperationError(400, "INVALID_PATH", err instanceof Error ? err.message : String(err), i);
          }
        }
        if (item.page_type && !isValidPageType(item.page_type)) {
          throw new BatchOperationError(400, "INVALID_PAGE_TYPE", `invalid page_type: ${item.page_type}`, i);
        }
        const conflictDoc = snapshotByPath.get(relPath) ?? (await db.getDocumentByRelativePath(relPath));
        if (conflictDoc && !deletedPaths.has(relPath)) {
          throw new BatchOperationError(409, "PATH_CONFLICT", `op[${i}] target path already exists: ${relPath}`, i);
        }
        let dir = path.posix.dirname(`/${relPath}`);
        if (!dir.endsWith("/")) dir += "/";
        const fm = parseFrontmatter(item.content ?? "");
        const resolvedPageType =
          sourceKind === "wiki" ? resolvePageType(fm.type, item.page_type ?? "", relPath) : "";
        const initialContent =
          sourceKind === "wiki" && item.page_type && !fm.type
            ? upsertFrontmatterFields(item.content ?? "", { type: resolvedPageType })
            : (item.content ?? "");
        const doc: Document = {
          id: randomUUID(),
          user_id: "default",
          filename: path.posix.basename(relPath),
          title: item.title || fm.title || "",
          path: dir,
          relative_path: relPath,
          source_kind: sourceKind,
          file_type: path.extname(relPath).replace(/^\./, "") || "md",
          file_size: Buffer.byteLength(initialContent, "utf8"),
          document_number: 0,
          status: "ready",
          page_count: 0,
          content: initialContent,
          tags: item.tags ?? fm.tags ?? [],
          date: fm.date || "",
          metadata: "",
          error_message: "",
          version: 0,
          parser: "",
          content_hash: sha256(initialContent),
          stale_since: "",
          highlights: "[]",
          created_at: "",
          updated_at: "",
          page_type: resolvedPageType,
        };
        deletedPaths.delete(relPath);
        snapshotById.set(doc.id, doc);
        snapshotByPath.set(relPath, doc);
        staged.set(doc.id, { doc, relPath, operation: "create" });
        const f = folderPathFromWikiRelPath(relPath);
        if (f) affectedFolders.add(f);
        results.push({ op_index: i, op: "create", document_id: doc.id, relative_path: relPath });
        break;
      }

      case "replace": {
        const doc = await resolveTargetDoc(db, snapshotById, snapshotByPath, deletedIds, item, i);
        assertOptimisticLock(doc, item.expected_version, item.expected_content_hash, i);
        doc.content = item.content ?? "";
        doc.content_hash = sha256(doc.content);
        if (doc.source_kind === "wiki") {
          const fm = parseFrontmatter(doc.content);
          if (fm.type) doc.page_type = resolvePageType(fm.type, doc.page_type ?? "", doc.relative_path);
        }
        snapshotById.set(doc.id, doc);
        snapshotByPath.set(doc.relative_path, doc);
        staged.set(doc.id, { doc, relPath: doc.relative_path, operation: staged.get(doc.id)?.operation ?? "update" });
        const f = folderPathFromWikiRelPath(doc.relative_path);
        if (f) affectedFolders.add(f);
        results.push({ op_index: i, op: "replace", document_id: doc.id, relative_path: doc.relative_path });
        break;
      }

      case "patch": {
        const doc = await resolveTargetDoc(db, snapshotById, snapshotByPath, deletedIds, item, i);
        assertOptimisticLock(doc, item.expected_version, item.expected_content_hash, i);
        let patched;
        try {
          patched = applyTextEdits(doc.content ?? "", item.edits ?? []);
        } catch (err) {
          if (err instanceof TextPatchError) {
            throw new BatchOperationError(err.status, err.code, `op[${i}] ${err.message}`, i, err.details);
          }
          throw err;
        }
        doc.content = patched.content;
        doc.content_hash = sha256(doc.content);
        if (doc.source_kind === "wiki") {
          const fm = parseFrontmatter(doc.content);
          if (fm.type) doc.page_type = resolvePageType(fm.type, doc.page_type ?? "", doc.relative_path);
        }
        snapshotById.set(doc.id, doc);
        snapshotByPath.set(doc.relative_path, doc);
        staged.set(doc.id, { doc, relPath: doc.relative_path, operation: staged.get(doc.id)?.operation ?? "update" });
        const f = folderPathFromWikiRelPath(doc.relative_path);
        if (f) affectedFolders.add(f);
        results.push({ op_index: i, op: "patch", document_id: doc.id, relative_path: doc.relative_path });
        break;
      }

      case "update_meta": {
        const doc = await resolveTargetDoc(db, snapshotById, snapshotByPath, deletedIds, item, i);
        assertOptimisticLock(doc, item.expected_version, item.expected_content_hash, i);
        const fmUpdates: Record<string, string | string[] | undefined> = {};
        if (item.page_type !== undefined) {
          if (!isValidPageType(item.page_type)) {
            throw new BatchOperationError(400, "INVALID_PAGE_TYPE", `op[${i}] invalid page_type: ${item.page_type}`, i);
          }
          doc.page_type = item.page_type.trim().toLowerCase();
          fmUpdates.type = doc.page_type;
        }
        if (item.confidence !== undefined) {
          const conf = item.confidence.trim().toLowerCase();
          if (conf && !isValidConfidence(conf)) {
            throw new BatchOperationError(400, "INVALID_CONFIDENCE", `op[${i}] invalid confidence`, i);
          }
          doc.confidence = conf;
          fmUpdates.confidence = conf;
        }
        if (item.experience_kind !== undefined) {
          const kind = item.experience_kind.trim().toLowerCase();
          if (kind && !isValidExperienceKind(kind)) {
            throw new BatchOperationError(400, "INVALID_KIND", `op[${i}] invalid experience_kind`, i);
          }
          doc.experience_kind = kind;
          fmUpdates.kind = kind;
        }
        if (item.page_status !== undefined) {
          const status = item.page_status.trim().toLowerCase();
          if (doc.page_type === "experience" && status && !isValidExperienceStatus(status)) {
            throw new BatchOperationError(400, "INVALID_STATUS", `op[${i}] invalid experience status`, i);
          }
          doc.page_status = status;
          fmUpdates.status = status;
        }
        if (item.last_verified !== undefined) {
          const lv = item.last_verified.trim();
          if (lv && !isValidIsoDate(lv)) {
            throw new BatchOperationError(400, "INVALID_DATE", `op[${i}] invalid last_verified`, i);
          }
          doc.last_verified = lv;
          fmUpdates.last_verified = lv;
        }
        if (item.review_after !== undefined) {
          const ra = item.review_after.trim();
          if (ra && !isValidIsoDate(ra)) {
            throw new BatchOperationError(400, "INVALID_DATE", `op[${i}] invalid review_after`, i);
          }
          doc.review_after = ra;
          fmUpdates.review_after = ra;
        }
        if (item.aliases !== undefined) {
          doc.aliases = item.aliases.map((a) => a.trim()).filter(Boolean);
          fmUpdates.aliases = doc.aliases;
        }
        if (item.symptoms !== undefined) {
          doc.symptoms = item.symptoms.map((s) => s.trim()).filter(Boolean);
          fmUpdates.symptoms = doc.symptoms;
        }
        if (item.title) {
          doc.title = item.title;
          fmUpdates.title = item.title;
        }
        if (item.tags !== undefined) {
          doc.tags = item.tags;
          fmUpdates.tags = item.tags;
        }
        if (item.date) {
          doc.date = item.date;
          fmUpdates.date = item.date;
        }
        if (item.metadata) doc.metadata = item.metadata;
        if (doc.source_kind === "wiki" && Object.keys(fmUpdates).length > 0) {
          doc.content = upsertFrontmatterFields(doc.content ?? "", fmUpdates);
          syncDocumentMetaFromContent(doc);
        }
        doc.content_hash = sha256(doc.content ?? "");
        snapshotById.set(doc.id, doc);
        snapshotByPath.set(doc.relative_path, doc);
        staged.set(doc.id, { doc, relPath: doc.relative_path, operation: staged.get(doc.id)?.operation ?? "update" });
        results.push({ op_index: i, op: "update_meta", document_id: doc.id, relative_path: doc.relative_path });
        break;
      }

      case "move": {
        const doc = await resolveTargetDoc(db, snapshotById, snapshotByPath, deletedIds, item, i);
        assertOptimisticLock(doc, item.expected_version, item.expected_content_hash, i);
        if (doc.source_kind !== "wiki" || isSystemDocPath(doc.relative_path)) {
          throw new BatchOperationError(400, "SYSTEM_PAGE_PROTECTED", `op[${i}] cannot move ${doc.relative_path}`, i);
        }
        let targetFolder: string;
        try {
          targetFolder = validateOptionalFolderPath(item.target_folder ?? "");
        } catch (err) {
          throw new BatchOperationError(400, "INVALID_FOLDER", err instanceof Error ? err.message : String(err), i);
        }
        let filename = (item.filename ?? "").trim() || doc.filename;
        filename = path.posix.basename(filename.replace(/\\/g, "/"));
        if (!filename || filename === "." || filename === "..") {
          throw new BatchOperationError(400, "INVALID_FILENAME", `op[${i}] invalid filename`, i);
        }
        if (!filename.toLowerCase().endsWith(".md")) filename += ".md";
        const newRelPath = targetFolder ? `wiki/${targetFolder}/${filename}` : `wiki/${filename}`;
        if (!targetFolder && RESERVED_TOP_LEVEL_WIKI_PAGES.has(newRelPath)) {
          throw new BatchOperationError(400, "SYSTEM_PAGE_PROTECTED", `op[${i}] reserved path ${newRelPath}`, i);
        }
        const oldRelPath = doc.relative_path;
        if (newRelPath !== oldRelPath) {
          const existingAtTarget = snapshotByPath.get(newRelPath) ?? (await db.getDocumentByRelativePath(newRelPath));
          if (existingAtTarget && existingAtTarget.id !== doc.id && !deletedPaths.has(newRelPath)) {
            throw new BatchOperationError(409, "PATH_CONFLICT", `op[${i}] target path exists: ${newRelPath}`, i);
          }
          snapshotByPath.delete(oldRelPath);
          deletedPaths.add(oldRelPath);
          deletedPaths.delete(newRelPath);
          const oldFolder = folderPathFromWikiRelPath(oldRelPath);
          if (oldFolder) affectedFolders.add(oldFolder);
          doc.relative_path = newRelPath;
          doc.path = `/${path.posix.dirname(newRelPath)}/`;
          doc.filename = filename;
          snapshotById.set(doc.id, doc);
          snapshotByPath.set(newRelPath, doc);
          staged.set(doc.id, { doc, relPath: newRelPath, operation: "move", oldRelPath });
          rewrites.push({ oldRelPath, newRelPath });
          const newFolder = folderPathFromWikiRelPath(newRelPath);
          if (newFolder) affectedFolders.add(newFolder);
        }
        results.push({
          op_index: i,
          op: "move",
          document_id: doc.id,
          relative_path: doc.relative_path,
          old_relative_path: oldRelPath,
        });
        break;
      }

      case "archive": {
        const doc = await resolveTargetDoc(db, snapshotById, snapshotByPath, deletedIds, item, i);
        assertOptimisticLock(doc, item.expected_version, item.expected_content_hash, i);
        if (isSystemDocPath(doc.relative_path)) {
          throw new BatchOperationError(400, "SYSTEM_PAGE_PROTECTED", `op[${i}] system page cannot be archived`, i);
        }
        const archived = buildArchivedDocument(doc, {
          reason: item.reason ?? "",
          supersededBy: item.superseded_by,
          date: item.date,
        });
        snapshotById.set(archived.id, archived);
        snapshotByPath.set(archived.relative_path, archived);
        staged.set(archived.id, { doc: archived, relPath: archived.relative_path, operation: "archive" });
        const f = folderPathFromWikiRelPath(archived.relative_path);
        if (f) affectedFolders.add(f);
        results.push({ op_index: i, op: "archive", document_id: archived.id, relative_path: archived.relative_path });
        break;
      }

      case "reopen": {
        const doc = await resolveTargetDoc(db, snapshotById, snapshotByPath, deletedIds, item, i);
        assertOptimisticLock(doc, item.expected_version, item.expected_content_hash, i);
        const reopened = buildReopenedDocument(doc, {
          reason: item.reason,
          confidence: item.confidence,
          lastVerified: item.last_verified,
          reviewAfter: item.review_after,
          date: item.date,
        });
        snapshotById.set(reopened.id, reopened);
        snapshotByPath.set(reopened.relative_path, reopened);
        staged.set(reopened.id, { doc: reopened, relPath: reopened.relative_path, operation: "reopen" });
        const f = folderPathFromWikiRelPath(reopened.relative_path);
        if (f) affectedFolders.add(f);
        results.push({ op_index: i, op: "reopen", document_id: reopened.id, relative_path: reopened.relative_path });
        break;
      }

      case "delete": {
        const doc = await resolveTargetDoc(db, snapshotById, snapshotByPath, deletedIds, item, i);
        assertOptimisticLock(doc, item.expected_version, item.expected_content_hash, i);
        if (isSystemDocPath(doc.relative_path)) {
          throw new BatchOperationError(400, "SYSTEM_PAGE_PROTECTED", `op[${i}] system page cannot be deleted`, i);
        }
        deletedIds.add(doc.id);
        deletedPaths.add(doc.relative_path);
        snapshotById.delete(doc.id);
        snapshotByPath.delete(doc.relative_path);
        staged.set(doc.id, { doc: null, relPath: doc.relative_path, operation: "delete" });
        const f = folderPathFromWikiRelPath(doc.relative_path);
        if (f) affectedFolders.add(f);
        results.push({ op_index: i, op: "delete", document_id: doc.id, relative_path: doc.relative_path });
        break;
      }

      default:
        throw new BatchOperationError(
          400,
          "BATCH_VALIDATION_ERROR",
          `unsupported op at index ${i}: ${(item as { op?: unknown }).op}`,
          i,
        );
    }
  }

  // Rewrite wiki path links once across all active wiki pages for any moves in the batch
  const rewrittenLinkPages: string[] = [];
  if (rewrites.length > 0 && typeof db.listDocumentsWithContent === "function") {
    const allWiki = await db.listDocumentsWithContent();
    for (const candidate of allWiki) {
      if (candidate.source_kind !== "wiki" || candidate.deleted_at || deletedIds.has(candidate.id)) continue;
      if (candidate.relative_path.startsWith("wiki/templates/")) continue;
      const currentDoc = snapshotById.get(candidate.id) ?? candidate;
      const { content: nextContent, changed } = rewriteWikiPathLinks(
        currentDoc.content ?? "",
        rewrites,
        currentDoc.relative_path,
      );
      if (!changed) continue;
      const updatedDoc: Document = {
        ...currentDoc,
        content: nextContent,
        content_hash: sha256(nextContent),
      };
      snapshotById.set(updatedDoc.id, updatedDoc);
      snapshotByPath.set(updatedDoc.relative_path, updatedDoc);
      const existingStage = staged.get(updatedDoc.id);
      staged.set(updatedDoc.id, {
        doc: updatedDoc,
        relPath: updatedDoc.relative_path,
        operation: existingStage?.operation ?? "update",
        oldRelPath: existingStage?.oldRelPath,
      });
      rewrittenLinkPages.push(updatedDoc.relative_path);
    }
  }

  // Canonical conflict check before any DB write
  if (typeof db.listDocumentsFiltered === "function") {
    const existingActive = await db.listDocumentsFiltered({ source_kind: "wiki", archived: "exclude" });
    const existingFiltered = existingActive.filter((d) => !deletedIds.has(d.id) && !staged.has(d.id));
    const accepted: Document[] = [];
    for (const entry of staged.values()) {
      if (!entry.doc || entry.doc.source_kind !== "wiki" || entry.doc.archived_at) continue;
      const conflict = findCanonicalPageConflict(entry.doc, [...existingFiltered, ...accepted]);
      if (conflict) {
        throw new CanonicalPageConflictError(entry.relPath, conflict);
      }
      accepted.push(entry.doc);
    }
  }

  if (input.dry_run) {
    return {
      dry_run: true,
      ok: true,
      op_count: ops.length,
      affected_pages: staged.size,
      rewritten_link_pages: rewrittenLinkPages,
      results,
    };
  }

  // Phase 2: single atomic change_set write
  const writes: PageWrite[] = [];
  const extracted = new Map<string, ExtractedReferenceEntry[]>();
  const replaceExistingEntries = new Set<string>();
  const rebuildPaths = new Set<string>();

  for (const entry of staged.values()) {
    if (!entry.doc) {
      writes.push({
        relative_path: entry.relPath,
        document: null,
        operation: "delete",
        chunks: [],
        refs: [],
      });
      continue;
    }
    const norm = normalizeWikiContent(entry.doc.content ?? "", entry.doc.source_kind, entry.doc.file_type);
    entry.doc.content = norm.content;
    entry.doc.content_hash = sha256(norm.content);
    writes.push({
      relative_path: entry.relPath,
      document: entry.doc,
      operation: entry.operation,
      chunks: buildPageChunks(entry.doc.id, norm.content),
      refs: [],
    });
    extracted.set(entry.relPath, norm.entries);
    if (entry.operation !== "create") replaceExistingEntries.add(entry.relPath);
    rebuildPaths.add(entry.relPath);
  }

  const changeSetId = randomUUID();
  const summary = (input.summary ?? "").trim() || `batch ${ops.length} op(s) (${actor})`;
  await db.applyChangeSet(
    {
      id: changeSetId,
      kind: "manual",
      summary,
      page_count: writes.length,
      created_at: "",
    },
    writes,
  );

  if (extracted.size > 0) {
    await storeReferenceEntries(db, extracted, replaceExistingEntries).catch(() => undefined);
  }
  if (rebuildPaths.size > 0) {
    await rebuildReferences(db, [...rebuildPaths]).catch(() => undefined);
  }
  if (affectedFolders.size > 0) {
    await refreshFolderOverviews(db, [...affectedFolders]).catch(() => undefined);
  }

  return {
    dry_run: false,
    ok: true,
    change_set_id: changeSetId,
    op_count: ops.length,
    affected_pages: writes.length,
    rewritten_link_pages: rewrittenLinkPages,
    results,
  };
}
