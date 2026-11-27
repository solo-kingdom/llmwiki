import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chunkText, defaultChunkConfig } from "../engine/chunker.js";
import { refreshFolderOverviews } from "../engine/folder_overview.js";
import { parseFrontmatter, upsertFrontmatterFields } from "../engine/frontmatter.js";
import { folderPathFromWikiRelPath, isValidPageType, validateWikiWritePath } from "../engine/wiki_org.js";
import type { Store } from "../store/interfaces.js";
import type { Document, PageWrite } from "../store/types.js";
import { openCliStore } from "./workspace.js";

export type StructureMigrationAction = "move" | "retype" | "merge";

export interface StructureMigrationFolder {
  path: string;
  display_name?: string;
  description?: string;
  sort_order?: number;
}

export interface StructureMigrationManifest {
  folders: StructureMigrationFolder[];
  entries: StructureMigrationEntry[];
}

export interface StructureMigrationEntry {
  batch: string;
  document_id: string;
  old_path: string;
  new_path: string;
  old_type: string;
  new_type: string;
  action: StructureMigrationAction;
  rationale: string;
  confidence: "high" | "medium" | "low";
  status: string;
  content_hash?: string;
  merge_into_document_id?: string;
}

export interface StructureMigrationIssue {
  code: string;
  path: string;
  message: string;
}

export interface StructureMigrationReport {
  valid: boolean;
  dry_run: true;
  stats: {
    entries: number;
    batches: number;
    move: number;
    retype: number;
    merge: number;
  };
  issues: StructureMigrationIssue[];
}

export function parseStructureMigrationDocument(raw: string): StructureMigrationManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`migration manifest is invalid JSON: ${errorMessage(error)}`);
  }
  const rawEntries = Array.isArray(value) ? value : (value as { entries?: unknown })?.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new Error("migration manifest must be a non-empty array or {entries:[...]} object");
  }
  const rawFolders = !Array.isArray(value) && Array.isArray((value as { folders?: unknown })?.folders)
    ? ((value as { folders: unknown[] }).folders)
    : [];
  const folders: StructureMigrationFolder[] = rawFolders.map((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`migration folders[${idx}] must be an object`);
    }
    const obj = item as Record<string, unknown>;
    const folderPath = stringValue(obj.path);
    if (!folderPath) throw new Error(`migration folders[${idx}].path is required`);
    return {
      path: folderPath,
      ...(stringValue(obj.display_name) ? { display_name: stringValue(obj.display_name) } : {}),
      ...(stringValue(obj.description) ? { description: stringValue(obj.description) } : {}),
      ...(typeof obj.sort_order === "number" ? { sort_order: obj.sort_order } : {}),
    };
  });
  return {
    folders,
    entries: rawEntries.map((entry, index) => parseEntry(entry, index)),
  };
}

export function parseStructureMigrationManifest(raw: string): StructureMigrationEntry[] {
  return parseStructureMigrationDocument(raw).entries;
}

export async function dryRunStructureMigration(
  db: Store,
  entries: StructureMigrationEntry[],
): Promise<StructureMigrationReport> {
  const docs = await db.listDocumentsWithContent();
  const byID = new Map(docs.map((doc) => [doc.id, doc]));
  const byPath = new Map(docs.map((doc) => [doc.relative_path, doc]));
  const issues: StructureMigrationIssue[] = [];
  const sourceIDs = new Set<string>();
  const targetPaths = new Map<string, StructureMigrationEntry[]>();
  const stats = {
    entries: entries.length,
    batches: new Set(entries.map((entry) => entry.batch)).size,
    move: entries.filter((entry) => entry.action === "move").length,
    retype: entries.filter((entry) => entry.action === "retype").length,
    merge: entries.filter((entry) => entry.action === "merge").length,
  };

  for (const entry of entries) {
    if (sourceIDs.has(entry.document_id)) {
      issue(issues, "duplicate_source", entry.old_path, `document_id 在 manifest 中重复: ${entry.document_id}`);
    }
    sourceIDs.add(entry.document_id);
    const targets = targetPaths.get(entry.new_path) ?? [];
    targets.push(entry);
    targetPaths.set(entry.new_path, targets);
    if (entry.status !== "pending") {
      issue(issues, "entry_not_pending", entry.old_path, `只允许 dry-run pending 条目，当前 status=${entry.status}`);
    }

    const source = byID.get(entry.document_id);
    const oldPathDoc = byPath.get(entry.old_path);
    if (!source || source.relative_path !== entry.old_path) {
      issue(issues, "source_mismatch", entry.old_path, `document_id 与 old_path 不匹配: ${entry.document_id}`);
    }
    const current = source ?? oldPathDoc;
    if (current) {
      if (current.page_type !== entry.old_type) {
        issue(issues, "type_mismatch", entry.old_path, `old_type=${entry.old_type}，实际为 ${current.page_type || "(empty)"}`);
      }
      if (entry.content_hash && current.content_hash !== entry.content_hash) {
        issue(issues, "content_hash_mismatch", entry.old_path, "content_hash 已变化，请重新生成 manifest");
      }
      if (current.archived_at || current.deleted_at) {
        issue(issues, "source_archived", entry.old_path, "只允许迁移活跃页面");
      }
    }
    try {
      validateWikiWritePath(entry.new_path);
    } catch (error) {
      issue(issues, "invalid_target", entry.new_path, errorMessage(error));
    }

    const target = byPath.get(entry.new_path);
    if (entry.action === "merge") {
      const mergeTarget = byID.get(entry.merge_into_document_id ?? "");
      if (!mergeTarget) {
        issue(issues, "merge_target_missing", entry.old_path, "merge_into_document_id 必须指向已有 canonical 页面");
      } else if (mergeTarget.relative_path !== entry.new_path) {
        issue(issues, "merge_target_path", entry.new_path, `new_path 必须等于 merge target 路径: ${mergeTarget.relative_path}`);
      }
      if (mergeTarget?.id === entry.document_id) {
        issue(issues, "merge_target_missing", entry.old_path, "merge target 不能与 source 相同");
      }
    } else if (target && target.id !== entry.document_id && !sourceIDsHasPath(entries, target.relative_path)) {
      issue(issues, "target_conflict", entry.new_path, `目标路径已被 ${target.id} 占用`);
    }
  }

  for (const [targetPath, targetEntries] of targetPaths) {
    if (targetEntries.length > 1 && targetEntries.some((entry) => entry.action !== "merge")) {
      for (const entry of targetEntries) {
        issue(issues, "duplicate_target", targetPath, "多个非 merge 条目指向同一 new_path");
      }
    }
  }

  return { valid: issues.length === 0, dry_run: true, stats, issues };
}

export interface StructureMigrationApplyReport {
  valid: boolean;
  dry_run: false;
  applied: number;
  moved: number;
  retyped: number;
  merged: number;
  folders_ensured: number;
  reverse_entries: StructureMigrationEntry[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildChunksForDoc(docId: string, content: string) {
  const cfg = defaultChunkConfig();
  return chunkText(content, 1, cfg).map((c) => ({
    id: `${docId}:${c.index}`,
    document_id: docId,
    chunk_index: c.index,
    content: c.content,
    page: c.page,
    start_char: c.startChar,
    token_count: c.tokenCount,
    header_breadcrumb: c.headerBreadcrumb,
  }));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

export async function applyStructureMigration(
  db: Store,
  manifestOrEntries: StructureMigrationManifest | StructureMigrationEntry[],
  options: { batch?: string; reverseOut?: string; actor?: string } = {},
): Promise<StructureMigrationApplyReport> {
  const manifest: StructureMigrationManifest = Array.isArray(manifestOrEntries)
    ? { folders: [], entries: manifestOrEntries }
    : manifestOrEntries;
  const targetEntries = options.batch
    ? manifest.entries.filter((entry) => entry.batch === options.batch)
    : manifest.entries;
  if (targetEntries.length === 0) {
    throw new Error(options.batch ? `no migration entries found for batch=${options.batch}` : "migration manifest has no entries");
  }

  const report = await dryRunStructureMigration(db, targetEntries);
  if (!report.valid) {
    const details = report.issues.map((i) => `${i.code}@${i.path}: ${i.message}`).join("; ");
    throw new Error(`structure migration validation failed: ${details}`);
  }

  let foldersEnsured = 0;
  for (const folder of manifest.folders) {
    const existing = typeof db.getFolder === "function" ? await db.getFolder(folder.path) : null;
    if (!existing && typeof db.createFolder === "function") {
      await db.createFolder(folder);
      foldersEnsured++;
    } else if (existing && typeof db.updateFolder === "function" && (folder.display_name || folder.description || folder.sort_order !== undefined)) {
      await db.updateFolder(folder.path, {
        ...(folder.display_name ? { display_name: folder.display_name } : {}),
        ...(folder.description ? { description: folder.description } : {}),
        ...(folder.sort_order !== undefined ? { sort_order: folder.sort_order } : {}),
      });
      foldersEnsured++;
    }
  }

  const actor = options.actor ?? "migrate-structure";
  const reverseEntries: StructureMigrationEntry[] = [];
  const affectedFolders = new Set<string>();
  let moved = 0;
  let retyped = 0;
  let merged = 0;

  for (const entry of targetEntries) {
    const oldFolder = folderPathFromWikiRelPath(entry.old_path);
    const newFolder = folderPathFromWikiRelPath(entry.new_path);
    const newFilename = path.posix.basename(entry.new_path);
    if (oldFolder) affectedFolders.add(oldFolder);
    if (newFolder) affectedFolders.add(newFolder);

    if (entry.action === "move" || entry.action === "retype") {
      if (entry.old_path !== entry.new_path) {
        await db.moveDocument(entry.document_id, newFolder, newFilename, actor);
        moved++;
      }
      if (entry.action === "retype" || entry.old_type !== entry.new_type) {
        const current = (await db.getDocument(entry.document_id))
          ?? (await db.listDocumentsWithContent()).find((d) => d.id === entry.document_id);
        if (!current) throw new Error(`document not found after move: ${entry.document_id}`);
        const updatedContent = upsertFrontmatterFields(current.content, { type: entry.new_type });
        const updatedDoc: Document = {
          ...current,
          content: updatedContent,
          content_hash: sha256(updatedContent),
          page_type: entry.new_type,
        };
        const write: PageWrite = {
          relative_path: updatedDoc.relative_path,
          document: updatedDoc,
          operation: "update",
          chunks: buildChunksForDoc(updatedDoc.id, updatedContent),
          refs: [],
        };
        await db.applyChangeSet(
          {
            id: randomUUID(),
            kind: "manual",
            summary: `migrate-structure retype ${entry.old_type} -> ${entry.new_type}: ${updatedDoc.relative_path}`,
            page_count: 1,
            created_at: "",
          },
          [write],
        );
        retyped++;
      }
      reverseEntries.push({
        ...entry,
        old_path: entry.new_path,
        new_path: entry.old_path,
        old_type: entry.new_type,
        new_type: entry.old_type,
        action: entry.action,
        status: "pending",
      });
      continue;
    }

    // action === "merge"
    const docs = await db.listDocumentsWithContent();
    const source = docs.find((d) => d.id === entry.document_id);
    const target = docs.find((d) => d.id === entry.merge_into_document_id);
    if (!source || !target) {
      throw new Error(`merge source or target missing: ${entry.document_id} -> ${entry.merge_into_document_id}`);
    }
    const sourceFm = parseFrontmatter(source.content);
    const targetFm = parseFrontmatter(target.content);
    const mergedAliases = Array.from(new Set([
      ...stringList(targetFm.aliases),
      ...stringList(sourceFm.aliases),
      ...(source.title && source.title !== target.title ? [source.title] : []),
    ]));
    const mergedSources = Array.from(new Set([
      ...stringList(targetFm.sources),
      ...stringList(sourceFm.sources),
    ]));
    let mergedContent = upsertFrontmatterFields(target.content, {
      ...(mergedAliases.length > 0 ? { aliases: mergedAliases } : {}),
      ...(mergedSources.length > 0 ? { sources: mergedSources } : {}),
    });
    const sourceBody = stripFrontmatter(source.content);
    if (sourceBody && !mergedContent.includes(sourceBody)) {
      mergedContent = `${mergedContent.trimEnd()}\n\n## 合并来源：${source.title || source.filename}\n\n${sourceBody}\n`;
    }
    const updatedTarget: Document = {
      ...target,
      content: mergedContent,
      content_hash: sha256(mergedContent),
    };
    const archiveSources =
      typeof db.listDocumentArchiveSources === "function"
        ? await db.listDocumentArchiveSources(source.id)
        : [];
    const writes: PageWrite[] = [
      {
        relative_path: updatedTarget.relative_path,
        document: updatedTarget,
        operation: "update",
        chunks: buildChunksForDoc(updatedTarget.id, mergedContent),
        refs: [],
      },
      {
        relative_path: source.relative_path,
        document: null,
        operation: "delete",
        chunks: [],
        refs: [],
      },
    ];
    await db.applyChangeSet(
      {
        id: randomUUID(),
        kind: "manual",
        summary: `migrate-structure merge ${source.relative_path} -> ${target.relative_path}`,
        page_count: writes.length,
        created_at: "",
      },
      writes,
    );
    if (archiveSources.length > 0 && typeof db.linkDocumentArchiveSource === "function") {
      for (const link of archiveSources) {
        await db.linkDocumentArchiveSource(target.id, link.id, undefined, "merged_source");
      }
    }
    merged++;
  }

  if (affectedFolders.size > 0 && typeof db.listFolders === "function") {
    await refreshFolderOverviews(db, Array.from(affectedFolders));
  }

  if (options.reverseOut) {
    await writeFile(
      options.reverseOut,
      `${JSON.stringify({ generated_at: new Date().toISOString(), entries: reverseEntries }, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    valid: true,
    dry_run: false,
    applied: targetEntries.length,
    moved,
    retyped,
    merged,
    folders_ensured: foldersEnsured,
    reverse_entries: reverseEntries,
  };
}

export async function runMigrateStructure(
  options: { manifest?: string; dryRun?: boolean; apply?: boolean; batch?: string; reverseOut?: string },
  databaseUrl?: string,
): Promise<void> {
  if (!options.manifest) throw new Error("--manifest is required");
  if (!options.dryRun && !options.apply) {
    throw new Error("specify either --dry-run or --apply");
  }
  if (options.dryRun && options.apply) {
    throw new Error("--dry-run and --apply are mutually exclusive");
  }
  const manifest = parseStructureMigrationDocument(await readFile(options.manifest, "utf8"));
  const store = await openCliStore(databaseUrl);
  try {
    if (options.dryRun) {
      const entries = options.batch
        ? manifest.entries.filter((e) => e.batch === options.batch)
        : manifest.entries;
      const report = await dryRunStructureMigration(store, entries);
      console.log(JSON.stringify(report, null, 2));
      if (!report.valid) throw new Error(`structure migration dry-run failed with ${report.issues.length} issue(s)`);
      return;
    }
    const result = await applyStructureMigration(store, manifest, {
      batch: options.batch,
      reverseOut: options.reverseOut,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.close();
  }
}

function parseEntry(value: unknown, index: number): StructureMigrationEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`migration entries[${index}] must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const required = ["batch", "document_id", "old_path", "new_path", "old_type", "new_type", "action", "rationale", "confidence", "status"];
  for (const key of required) {
    if (typeof raw[key] !== "string" || !raw[key].trim()) {
      throw new Error(`migration entries[${index}].${key} is required`);
    }
  }
  const action = stringValue(raw.action);
  if (action !== "move" && action !== "retype" && action !== "merge") {
    throw new Error(`migration entries[${index}].action must be move, retype, or merge`);
  }
  const oldType = stringValue(raw.old_type).toLowerCase();
  const newType = stringValue(raw.new_type).toLowerCase();
  if (!isValidPageType(oldType) || !isValidPageType(newType) || newType === "page") {
    throw new Error(`migration entries[${index}] has invalid old_type/new_type`);
  }
  const confidence = stringValue(raw.confidence).toLowerCase();
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    throw new Error(`migration entries[${index}].confidence must be high, medium, or low`);
  }
  return {
    batch: stringValue(raw.batch),
    document_id: stringValue(raw.document_id),
    old_path: stringValue(raw.old_path),
    new_path: stringValue(raw.new_path),
    old_type: oldType,
    new_type: newType,
    action,
    rationale: stringValue(raw.rationale),
    confidence,
    status: stringValue(raw.status),
    ...(stringValue(raw.content_hash) ? { content_hash: stringValue(raw.content_hash) } : {}),
    ...(stringValue(raw.merge_into_document_id) ? { merge_into_document_id: stringValue(raw.merge_into_document_id) } : {}),
  };
}

function sourceIDsHasPath(entries: StructureMigrationEntry[], relativePath: string): boolean {
  return entries.some((entry) => entry.old_path === relativePath && entry.action !== "merge");
}

function issue(issues: StructureMigrationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
