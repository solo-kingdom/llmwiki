import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import {
  AgentRuntimeError,
  ERR_ACP_AGENT_DISABLED,
  ERR_ACP_CLI_NOT_FOUND,
  ERR_ACP_CONFIG_INVALID,
  ERR_INVALID_HARNESS_KIND,
  ERR_NO_ACP_AGENT,
  ERR_NO_PROVIDER_INSTANCE,
  resolveSessionRuntime,
  type HarnessManager,
  type Runtime,
} from "../harness/index.js";
import { buildPageChunks, rebuildReferences, storeReferenceEntries } from "../ingest/dbapply.js";
import { normalizeWikiContent, type ExtractedReferenceEntry } from "../engine/ref_sections.js";
import { ReferenceParser, WIKI_DOUBLE_BRACKET_RE } from "../engine/references.js";
import type { PageLockManager } from "../ingest/lock.js";
import type { WorkspaceFileIndexer } from "../engine/file_indexer.js";
import { engineStoreFromStore } from "../engine/adapter.js";
import { logDocument, logMcpRemoteToolCall, logMcpTool } from "../activity/index.js";
import { logger } from "../logger.js";
import type { McpActivity } from "../mcp/tools.js";
import type { Store } from "../store/interfaces.js";
import type {
  ChangeSet,
  Document,
  IngestSession,
  PageWrite,
  RevisionOperation,
} from "../store/types.js";

export interface ApiContext {
  db: Store;
  workspace: string;
  lockMgr: PageLockManager | null;
  indexer: WorkspaceFileIndexer | null;
  publicWikiEnabled: boolean;
  harnessMgr: HarnessManager | null;
  flagToken: string;
}

export interface ApiDeps {
  db: Store;
  workspace?: string;
  lockMgr?: PageLockManager | null;
  indexer?: WorkspaceFileIndexer | null;
  publicWikiEnabled?: boolean;
  harnessMgr?: HarnessManager | null;
  flagToken?: string;
}

export function createApiContext(deps: ApiDeps): ApiContext {
  return {
    db: deps.db,
    workspace: deps.workspace ?? "",
    lockMgr: deps.lockMgr ?? null,
    indexer: deps.indexer ?? null,
    publicWikiEnabled: deps.publicWikiEnabled ?? false,
    harnessMgr: deps.harnessMgr ?? null,
    flagToken: deps.flagToken ?? "",
  };
}

export function engineStore(ctx: ApiContext) {
  return engineStoreFromStore(ctx.db);
}

export function mcpActivity(_ctx: ApiContext): McpActivity {
  return {
    logMcpTool: (db, toolName) => logMcpTool(db, toolName),
    logDocument: (db, action, documentId, relativePath, source) =>
      logDocument(db, action, documentId, relativePath, source),
    logMcpRemoteToolCall: (db, info) => logMcpRemoteToolCall(db, info),
  };
}

export function writeJson(c: Context, status: number, data: unknown): Response {
  return c.json(data as never, status as never);
}

export function writeError(c: Context, status: number, message: string): Response {
  if (status >= 500) logger.error({ status, message }, "[API ERROR]");
  return c.json({ error: message }, status as never);
}

export function getID(c: Context, name = "id"): string {
  return c.req.param(name) ?? "";
}

export function parseQueryInt(c: Context, key: string, defaultValue: number): number {
  const raw = c.req.query(key);
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const getIntQuery = parseQueryInt;

export async function readJsonBody<T = Record<string, unknown>>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

export function isStreamRequest(c: Context): boolean {
  return c.req.query("stream") === "1" || (c.req.header("accept") ?? "").includes("text/event-stream");
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}${"*".repeat(key.length - 4)}`;
}

export function trimJoin(dir: string, name: string): string {
  if (!dir || dir === "/") return name;
  if (dir.endsWith("/")) return `${dir.slice(1)}${name}`;
  return `${dir.slice(1)}/${name}`;
}

function requireWorkspace(ctx: ApiContext): string {
  if (!ctx.workspace.trim()) throw new Error("workspace not configured");
  return ctx.workspace;
}

export async function writeFileBytesFirst(ctx: ApiContext, canonicalPath: string, content: Uint8Array): Promise<void> {
  if (!ctx.workspace) return;
  const relPath = canonicalPath.replace(/^\/+/, "");
  const fullPath = path.join(ctx.workspace, relPath);
  const dir = path.dirname(fullPath);
  await mkdir(dir, { recursive: true, mode: 0o755 });
  const tmpPath = path.join(dir, `.llmwiki-write-${randomUUID()}`);
  try {
    await writeFile(tmpPath, content);
    await rename(tmpPath, fullPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

export async function writeFileFirst(ctx: ApiContext, canonicalPath: string, content: string): Promise<void> {
  await writeFileBytesFirst(ctx, canonicalPath, Buffer.from(content, "utf8"));
}

export async function removeWorkspaceFile(ctx: ApiContext, canonicalPath: string): Promise<void> {
  if (!ctx.workspace) return;
  const relPath = canonicalPath.replace(/^\/+/, "");
  await rm(path.join(ctx.workspace, relPath), { force: true });
}

export function readWorkspaceFile(ctx: ApiContext, relPath: string): Promise<Buffer> {
  const root = requireWorkspace(ctx);
  return readFile(path.join(root, relPath.replace(/^\/+/, "")));
}

export async function applyPageWrite(
  ctx: ApiContext,
  kind: string,
  summary: string,
  doc: Document,
  operation: RevisionOperation,
): Promise<void> {
  if (!doc) throw new Error("nil document");
  // Trailing reference sections never persist in content; they are extracted
  // into document_reference_entries at every write path.
  const norm = normalizeWikiContent(doc.content ?? "", doc.source_kind, doc.file_type);
  doc.content = norm.content;
  doc.content_hash = contentHash(doc.content);
  if (!doc.relative_path && doc.filename) {
    doc.relative_path = trimJoin(doc.path, doc.filename);
  }
  const changeSet: ChangeSet = {
    id: randomUUID(),
    kind,
    summary,
    page_count: 1,
    created_at: "",
  };
  const write: PageWrite = {
    relative_path: doc.relative_path,
    document: doc,
    operation,
    chunks: buildPageChunks(doc.id, doc.content),
    refs: [],
  };
  await ctx.db.applyChangeSet(changeSet, [write]);
  const extracted = new Map<string, ExtractedReferenceEntry[]>([[doc.relative_path, norm.entries]]);
  await storeReferenceEntries(ctx.db, extracted);
  await rebuildReferences(ctx.db, [doc.relative_path]);
}

export async function applyPageDelete(ctx: ApiContext, kind: string, summary: string, relPath: string): Promise<void> {
  await applyPageDeletes(ctx, kind, summary, [relPath]);
}

export async function applyPageDeletes(
  ctx: ApiContext,
  kind: string,
  summary: string,
  relPaths: string[],
): Promise<void> {
  const writes: PageWrite[] = [];
  for (const relPath of relPaths) {
    if (!relPath) continue;
    writes.push({
      relative_path: relPath,
      document: null,
      operation: "delete",
      chunks: [],
      refs: [],
    });
  }
  if (writes.length === 0) return;
  await ctx.db.applyChangeSet(
    { id: randomUUID(), kind, summary, page_count: writes.length, created_at: "" },
    writes,
  );
}

export function indexDocumentRelPath(ctx: ApiContext, relPath: string): void {
  if (!ctx.indexer || !relPath) return;
  void ctx.indexer.indexFile(relPath).catch((error: unknown) => {
    logger.warn({ error, relPath }, "api: index file");
  });
}

export function indexDocumentContent(ctx: ApiContext, docId: string, content: string): void {
  if (!ctx.indexer || !docId) return;
  void ctx.indexer.indexDocumentContent(docId, content).catch((error: unknown) => {
    logger.warn({ error, docId }, "api: index document");
  });
}

export async function sessionAgentRuntime(ctx: ApiContext, session: IngestSession | null): Promise<Runtime> {
  return resolveSessionRuntime(ctx.db, ctx.workspace, ctx.harnessMgr, session);
}

export function runtimeErrorMessage(error: unknown): string {
  if (error instanceof AgentRuntimeError) {
    switch (error.code) {
      case ERR_NO_PROVIDER_INSTANCE:
        return "请先选择 Provider 实例和 Model";
      case ERR_NO_ACP_AGENT:
        return "请先在 Settings → Harness 配置并选择 ACP Agent";
      case ERR_ACP_AGENT_DISABLED:
        return "该 ACP Agent 已禁用";
      case ERR_ACP_CLI_NOT_FOUND:
        return "ACP Agent 命令未找到，请确认已安装并在 PATH 中";
      case ERR_INVALID_HARNESS_KIND:
        return error.message;
      case ERR_ACP_CONFIG_INVALID:
        return error.message;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function requirePublicWiki(ctx: ApiContext, c: Context): Response | null {
  if (!ctx.publicWikiEnabled) return writeError(c, 403, "public wiki access is disabled");
  return null;
}

export function docRelativePath(doc: Document): string {
  if (doc.relative_path) return doc.relative_path;
  if (doc.filename) return `${doc.path.replace(/\/+$/, "")}/${doc.filename}`.replace(/^\/+/, "");
  return "";
}

export interface ReferenceEntryPayload {
  kind: "related" | "source";
  raw_text: string;
  target_document_id: string;
  annotation: string;
  target_title: string;
}

export interface WikilinkPayload {
  text: string;
  doc_id: string;
  title: string;
}

/** Reference payload appended to document responses: structured entries plus a
 * resolution map for inline [[..]] links so the web can render them clickable. */
export async function buildReferencesPayload(
  db: Store,
  doc: Document,
): Promise<{ reference_entries: ReferenceEntryPayload[]; wikilinks: WikilinkPayload[] }> {
  const entries = await db.listReferenceEntries(doc.id);
  const docs = await db.listDocumentsFiltered({ archived: "include" });
  const parser = new ReferenceParser(
    docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      title: d.title,
      path: d.path,
      aliases: d.aliases ?? [],
    })),
  );
  const docPath = `${doc.path}${doc.filename}`;
  const byText = new Map<string, WikilinkPayload>();
  for (const match of doc.content?.matchAll(WIKI_DOUBLE_BRACKET_RE) ?? []) {
    const text = (match[1] ?? "").trim();
    if (!text || byText.has(text)) continue;
    const docId = parser.resolveLink(text, docPath);
    const target = docId ? docs.find((d) => d.id === docId) : undefined;
    byText.set(text, {
      text,
      doc_id: docId,
      title: target?.title ?? target?.filename ?? "",
    });
  }
  return {
    reference_entries: entries.map((entry) => ({
      kind: entry.kind,
      raw_text: entry.rawText,
      target_document_id: entry.targetDocumentId,
      annotation: entry.annotation,
      target_title: entry.targetTitle || entry.targetFilename,
    })),
    wikilinks: [...byText.values()],
  };
}
