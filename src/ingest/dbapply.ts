import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chunkText, defaultChunkConfig } from "../engine/chunker.js";
import { getMetadataJSON, parseFrontmatter, titleFromFilename } from "../engine/frontmatter.js";
import { normalizeWikiContent, type ExtractedReferenceEntry } from "../engine/ref_sections.js";
import { ReferenceParser } from "../engine/references.js";
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

  const scratch = await mkdtemp(path.join(os.tmpdir(), "llmwiki-apply-"));
  try {
    for (const rel of normalized.blocks.keys()) {
      const doc = await state.db.getDocumentByRelativePath(rel);
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
      const existing = await state.db.getDocumentByRelativePath(rel);
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
    try {
      await storeReferenceEntries(state.db, extracted);
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
  const docs = await db.listDocuments();
  const parser = new ReferenceParser(
    docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      title: doc.title,
      path: doc.path,
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
 * Entries for a page are replaced wholesale, so pages whose references were
 * removed on regeneration do not keep stale rows. */
export async function storeReferenceEntries(
  db: Store,
  extracted: Map<string, ExtractedReferenceEntry[]>,
): Promise<void> {
  if (extracted.size === 0) return;
  const docs = await db.listDocuments();
  const parser = new ReferenceParser(
    docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      title: doc.title,
      path: doc.path,
    })),
  );
  for (const [rel, entries] of extracted) {
    const doc = await db.getDocumentByRelativePath(rel);
    if (!doc) continue;
    const docPath = `${doc.path}${doc.filename}`;
    await db.replaceReferenceEntriesInTx(
      doc.id,
      entries.map((entry) => ({
        kind: entry.kind,
        rawText: entry.rawText,
        targetDocumentId: parser.resolveLink(entry.rawText, docPath),
        annotation: entry.annotation,
        position: entry.position,
      })),
    );
  }
}

export const buildPageChunks = pageChunks;
export const rebuildDerivedReferences = rebuildReferences;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
