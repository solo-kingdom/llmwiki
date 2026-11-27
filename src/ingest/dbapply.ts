import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chunkText, defaultChunkConfig } from "../engine/chunker.js";
import { getMetadataJSON, parseFrontmatter, titleFromFilename } from "../engine/frontmatter.js";
import { normalizeWikiContent, type ExtractedReferenceEntry } from "../engine/ref_sections.js";
import { ReferenceParser } from "../engine/references.js";
import { experienceShapeScore } from "../engine/lint.js";
import {
  CONFIG_STRUCTURE_POLICY_MODE,
  evaluateWikiPlacement,
  parseStructurePolicyMode,
  writeOriginForChangeSet,
} from "../engine/placement_policy.js";
import { resolvePageType } from "../engine/wiki_org.js";
import type { Store } from "../store/interfaces.js";
import type { ChangeSet, Chunk, Document, PageWrite } from "../store/types.js";
import {
  applyWikiBlocks,
  normalizeWikiFileBlocks,
} from "./fileblocks.js";
import type { ApplyWikiBlocksOptions, ApplyWikiResult, JobRecorder } from "./types.js";

export interface ApplyState {
  applyToDB: boolean;
  db: Store | null;
  changeSetKind: string;
  changeSetJobId: string;
  changeSetReviewId: string;
  archiveFileId?: string;
  sourceFilename: string;
  normalizedContent: string;
  recorder: JobRecorder | null;
}

export async function applyBlocksToStore(
  workspace: string,
  blocks: Map<string, string>,
  options: ApplyWikiBlocksOptions,
  state: ApplyState,
): Promise<{ result: ApplyWikiResult; changeSetId: string }> {
  if (!state.db) throw new Error("database not configured");
  const normalized = normalizeWikiFileBlocks(blocks);
  if (normalized.adjustments.length > 0 && state.recorder) {
    state.recorder.record("apply_files", "warn", "normalized FILE paths", {
      adjustments: normalized.adjustments,
    });
  }

  const mode = parseStructurePolicyMode(
    typeof state.db.getConfig === "function"
      ? await state.db.getConfig(CONFIG_STRUCTURE_POLICY_MODE)
      : "",
  );
  const origin = writeOriginForChangeSet(state.changeSetKind);
  const folders = new Set<string>();
  if (mode === "enforce" && origin === "auto_ingest") {
    for (const folder of await state.db.listFolders(true)) folders.add(folder.path);
  }
  const existingByPath = new Map<string, Document | null>();
  for (const [rel, content] of normalized.blocks) {
    const existing = await state.db.getDocumentByRelativePath(rel);
    existingByPath.set(rel, existing);
    if (content === "---DELETE---\n") continue;
    const decision = evaluateWikiPlacement(rel, { mode, origin, existing: existing !== null, folders });
    for (const warning of decision.warnings) {
      state.recorder?.record("placement", "warn", warning, { path: rel, mode, origin });
    }
    if (origin === "auto_ingest" && !existing) {
      const fm = parseFrontmatter(content);
      if ((fm.type || "").toLowerCase() === "concept" && experienceShapeScore(content) >= 3) {
        const msg = `concept 页面呈明显经验排查结构（应改为 experience）: ${rel}`;
        if (mode === "enforce") throw new Error(msg);
        state.recorder?.record("placement", "warn", msg, { path: rel, mode, origin });
      }
      if ((fm.confidence || "").toLowerCase() === "high" && !fm.last_verified) {
        state.recorder?.record("placement", "warn", `首次自动生成页面自标 confidence: high 但缺少 last_verified，将降级为 medium: ${rel}`, { path: rel });
        normalized.blocks.set(
          rel,
          content.replace(/^confidence:\s*high\s*$/m, "confidence: medium"),
        );
      }
    }
  }

  const scratch = await mkdtemp(path.join(os.tmpdir(), "llmwiki-apply-"));
  try {
    for (const rel of normalized.blocks.keys()) {
      const doc = existingByPath.get(rel);
      if (!doc) continue;
      const full = path.join(scratch, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, doc.content, "utf8");
    }

    const result = await applyWikiBlocks(scratch, normalized.blocks, options);
    if (result.written.length === 0 && result.deleted.length === 0) {
      return { result, changeSetId: "" };
    }

    const changeSet: ChangeSet = {
      id: "",
      kind: state.changeSetKind,
      job_id: state.changeSetJobId,
      review_id: state.changeSetReviewId,
      archive_file_id: state.archiveFileId ?? "",
      source_filename: state.sourceFilename,
      normalized_content: state.normalizedContent,
      summary: `apply ${result.written.length} page(s)`,
      page_count: 0,
      created_at: "",
    };

    const writes: PageWrite[] = [];
    const extracted = new Map<string, ExtractedReferenceEntry[]>();
    for (const rel of result.written) {
      const data = await readFile(path.join(scratch, rel));
      let text = new TextDecoder().decode(data);
      const norm = normalizeWikiContent(text, "wiki", "md");
      extracted.set(rel, norm.entries);
      if (norm.entries.length > 0 || text !== norm.content) {
        text = norm.content;
        await writeFile(path.join(scratch, rel), Buffer.from(text, "utf8"));
      }
      const doc = await pageDocument(state.db, rel, Buffer.from(text, "utf8"));
      const existing = existingByPath.get(rel);
      writes.push({
        relative_path: rel,
        document: doc,
        operation: existing ? "update" : "create",
        chunks: pageChunks(doc.id, text),
        refs: [],
      });
    }
    for (const rel of result.deleted) {
      writes.push({
        relative_path: rel,
        document: null,
        operation: "delete",
        chunks: [],
        refs: [],
      });
    }

    await state.db.applyChangeSet(changeSet, writes);
    if (state.archiveFileId && typeof state.db.linkDocumentArchiveSource === "function") {
      for (const rel of result.written) {
        try {
          const doc = await state.db.getDocumentByRelativePath(rel);
          if (doc) {
            await state.db.linkDocumentArchiveSource(doc.id, state.archiveFileId, changeSet.id, "ingest_source");
          }
        } catch (error) {
          state.recorder?.record(
            "apply_files",
            "warn",
            `link archive source failed (${rel}): ${errorMessage(error)}`,
            null,
          );
        }
      }
    }
    try {
      const updatePaths = new Set(
        writes.filter((w) => w.operation === "update").map((w) => w.relative_path),
      );
      await storeReferenceEntries(state.db, extracted, updatePaths);
      await rebuildReferences(state.db, result.written);
    } catch (error) {
      state.recorder?.record("apply_files", "warn", `rebuild references: ${errorMessage(error)}`, null);
    }
    return { result, changeSetId: changeSet.id };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function pageDocument(db: Store, rel: string, data: Uint8Array): Promise<Document> {
  const filename = path.basename(rel);
  let dir = `/${path.dirname(rel).replace(/^\.\/?/, "").replace(/\/+$/, "")}/`;
  if (dir === "//" || dir === "/./") dir = "/";
  const content = new TextDecoder().decode(data);
  const frontmatter = parseFrontmatter(content);
  const title = frontmatter.title || titleFromFilename(filename);
  const hash = createHash("sha256").update(data).digest("hex");
  const pageType = resolvePageType(frontmatter.type, "", rel);
  const doc: Document = {
    id: "",
    user_id: "default",
    filename,
    title,
    path: dir,
    relative_path: rel,
    source_kind: "wiki",
    file_type: "md",
    file_size: data.length,
    document_number: 0,
    status: "ready",
    page_count: 0,
    content,
    tags: frontmatter.tags,
    date: frontmatter.date,
    metadata: getMetadataJSON(frontmatter),
    error_message: "",
    version: 0,
    parser: "",
    content_hash: hash,
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    page_type: pageType,
    confidence: frontmatter.confidence ?? "",
    page_status: frontmatter.status ?? "",
    experience_kind: frontmatter.kind ?? "",
    last_verified: frontmatter.last_verified ?? "",
    review_after: frontmatter.review_after ?? "",
    archived_at: frontmatter.archived_at ?? "",
    archive_reason: frontmatter.archive_reason ?? "",
    superseded_by: frontmatter.superseded_by ?? "",
    aliases: frontmatter.aliases ?? [],
    symptoms: frontmatter.symptoms ?? [],
  };
  const existing = await db.getDocumentByRelativePath(rel);
  if (existing) {
    doc.id = existing.id;
    doc.document_number = existing.document_number;
  }
  return doc;
}

export function pageChunks(docId: string, content: string): Chunk[] {
  if (!content.trim()) return [];
  const chunks = chunkText(content, 1, defaultChunkConfig());
  return chunks.map((chunk) => ({
    id: "",
    document_id: docId,
    chunk_index: chunk.index,
    content: chunk.content,
    page: chunk.page,
    start_char: chunk.startChar,
    token_count: chunk.tokenCount,
    header_breadcrumb: chunk.headerBreadcrumb,
  }));
}

export async function rebuildReferences(db: Store, relPaths: string[]): Promise<void> {
  if (relPaths.length === 0) return;
  const docs = await db.listDocumentsFiltered({ archived: "include" });
  const parser = new ReferenceParser(
    docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      title: doc.title,
      path: doc.path,
      aliases: doc.aliases ?? [],
    })),
  );
  for (const rel of relPaths) {
    const doc = await db.getDocumentByRelativePath(rel);
    if (!doc) continue;
    const refs = parser.parseReferences(doc.content, `${doc.path}${doc.filename}`);
    // Structured reference entries (stripped trailing sections) also count as edges
    // so graph/backlinks stay complete for stored content without inline links.
    const entries = await db.listReferenceEntries(doc.id);
    const entryEdges = entries
      .filter((entry) => entry.targetDocumentId)
      .map((entry) => ({
        source_id: doc.id,
        target_id: entry.targetDocumentId,
        ref_type: "links_to",
        page: null,
      }));
    const seen = new Set(refs.map((ref) => `${ref.targetPath}\0${ref.refType}`));
    const merged = [
      ...refs.map((ref) => ({
        source_id: doc.id,
        target_id: ref.targetPath,
        ref_type: ref.refType,
        page: ref.page,
      })),
      ...entryEdges.filter((edge) => !seen.has(`${edge.target_id}\0${edge.ref_type}`)),
    ];
    await db.replaceReferencesInTx(doc.id, merged);
  }
}

/** Resolve extracted entries against the current doc index and persist them.
 * For newly created pages entries are replaced; for existing updates entries are
 * merged by (kind, rawText) so prior ingest references are never wiped. */
export async function storeReferenceEntries(
  db: Store,
  extracted: Map<string, ExtractedReferenceEntry[]>,
  updatePaths: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (extracted.size === 0) return;
  const docs = await db.listDocumentsFiltered({ archived: "include" });
  const parser = new ReferenceParser(
    docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      title: doc.title,
      path: doc.path,
      aliases: doc.aliases ?? [],
    })),
  );
  for (const [rel, entries] of extracted) {
    const doc = await db.getDocumentByRelativePath(rel);
    if (!doc) continue;
    const docPath = `${doc.path}${doc.filename}`;
    const mapped = entries.map((entry) => ({
      kind: entry.kind,
      rawText: entry.rawText,
      targetDocumentId: parser.resolveLink(entry.rawText, docPath),
      annotation: entry.annotation,
      position: entry.position,
    }));
    if (updatePaths.has(rel) && typeof db.mergeReferenceEntriesInTx === "function") {
      await db.mergeReferenceEntriesInTx(doc.id, mapped);
    } else {
      await db.replaceReferenceEntriesInTx(doc.id, mapped);
    }
  }
}

export const buildPageChunks = pageChunks;
export const rebuildDerivedReferences = rebuildReferences;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
