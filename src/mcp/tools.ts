import { randomUUID } from "node:crypto";
import path from "node:path";
import { buildArchivedDocument, buildReopenedDocument } from "../engine/archive.js";
import { refreshFolderOverviews } from "../engine/folder_overview.js";
import { normalizeWikiContent, type ExtractedReferenceEntry } from "../engine/ref_sections.js";
import { applyTextEdits, TextPatchError, type TextEdit } from "../engine/text_patch.js";
import {
  BatchOperationError,
  executeWikiBatch,
  MAX_BATCH_GET,
  type BatchDocOp,
} from "../engine/wiki_batch.js";
import {
  folderPathFromWikiRelPath,
  isWikiSystemPath,
  RESERVED_TOP_LEVEL_WIKI_PAGES,
  validateWikiWritePath,
} from "../engine/wiki_org.js";
import { workspaceLayoutSummary } from "../engine/workspace_layout.js";
import {
  buildPageChunks,
  pageDocument,
  rebuildReferences,
  storeReferenceEntries,
} from "../ingest/dbapply.js";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import {
  executeLocalSearch,
  extractMarkdownOutline,
  formatDocumentRead,
  parseReadFormatOptions,
  resolveDocumentByIdOrPath,
} from "./local_tools.js";
import { registerArchiveTools } from "./archive_tools.js";
import type { AuditDb } from "./server.js";
import { McpServer } from "./server.js";
import type { Tool, ToolHandler } from "./types.js";

export interface McpActivity {
  logMcpTool(db: Store, toolName: string): void | Promise<void>;
  logDocument(
    db: Store,
    action: string,
    documentId: string,
    relativePath: string,
    source: string,
  ): void | Promise<void>;
  logMcpRemoteToolCall(
    db: Store,
    info: {
      toolName: string;
      remoteAddr: string;
      clientAgent: string;
      durationMs: number;
      status: string;
      errorType: string;
    },
  ): void | Promise<void>;
}

export function createAuditAdapter(db: Store, activity?: McpActivity): AuditDb {
  return {
    async recordMcpToolCall(toolName, remoteAddr, clientAgent, durationMs, status, errorType) {
      await activity?.logMcpRemoteToolCall(db, {
        toolName,
        remoteAddr,
        clientAgent,
        durationMs,
        status,
        errorType,
      });
    },
  };
}

export async function runLocalMcp(
  workspace: string,
  db: Store,
  activity?: McpActivity,
): Promise<void> {
  const server = new McpServer(
    "LLM Wiki",
    "You are connected to an LLM Wiki workspace. Call the `guide` tool first to see available knowledge bases and learn the full workflow.",
  );
  registerTools(server, workspace, db, activity);
  await server.runStdio();
}

export function registerTools(
  server: McpServer,
  workspace: string,
  db: Store,
  activity?: McpActivity,
): void {
  const register = (tool: Tool, handler: ToolHandler) => {
    server.registerTool(tool, async (args) => {
      await activity?.logMcpTool(db, tool.name);
      return handler(args);
    });
  };

  register(
    {
      name: "guide",
      description:
        "Get started with LLM Wiki. Call this to understand how the knowledge vault works and see your available knowledge bases.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    async () => guideText(db),
  );

  register(
    {
      name: "search",
      description:
        "Browse or search the knowledge vault. Modes: list (browse files), search (hybrid/keyword/semantic + exact/regex + scope), references (citation graph), lint (wiki health checks).",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["list", "search", "references", "lint"], default: "list" },
          query: { type: "string", default: "" },
          path: { type: "string", default: "*" },
          folder: { type: "string", description: "Optional wiki/archive subfolder filter" },
          limit: { type: "integer", default: 10 },
          search_mode: { type: "string", enum: ["hybrid", "keyword", "semantic"], default: "hybrid" },
          match: { type: "string", enum: ["fuzzy", "all_terms", "phrase", "regex"], default: "fuzzy" },
          case_sensitive: { type: "boolean", default: false },
          scope: { type: "string", enum: ["wiki", "archives", "all"], default: "wiki" },
          sort: { type: "string", enum: ["relevance", "updated_desc", "updated_asc"], default: "relevance" },
          types: { type: "array", items: { type: "string" } },
          kinds: { type: "array", items: { type: "string" } },
          statuses: { type: "array", items: { type: "string" } },
          confidences: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
          tag_mode: { type: "string", enum: ["any", "all"], default: "any" },
          archived: { type: "string", enum: ["exclude", "include", "only"], default: "exclude" },
        },
        required: [],
      },
    },
    async (args) => searchToolHandler(workspace, db, args),
  );

  register(
    {
      name: "read",
      description:
        "Read a document from the knowledge vault by path or document ID. Supports optional line range (line_start/line_end) and outline_only mode.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path or document ID to read" },
          line_start: { type: "integer", description: "Optional 1-based start line (inclusive)" },
          line_end: { type: "integer", description: "Optional 1-based end line (inclusive)" },
          outline_only: { type: "boolean", description: "Return only Markdown headings with line numbers" },
        },
        required: ["path"],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const requested = typeof args["path"] === "string" ? args["path"] : "";
      if (!requested) return "Error: path is required";
      const doc = await resolveDocumentByIdOrPath(db, requested);
      if (!doc) return `Document not found: ${requested}`;
      return formatDocumentRead(doc, parseReadFormatOptions(args));
    },
  );

  register(
    {
      name: "write",
      description:
        "Create, replace, patch, or append a wiki page. Supports id/relative_path targeting, atomic edits[], expected_version/expected_content_hash optimistic locking, and dry_run.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Existing document ID or relative_path (for replace/patch/append)" },
          mode: {
            type: "string",
            enum: ["create", "replace", "patch", "append"],
            description: "Write mode (default create; auto-patch if edits is provided)",
          },
          title: { type: "string", description: "Page title (for create/replace)" },
          content: { type: "string", description: "Full markdown content (create/replace) or text to append" },
          edits: {
            type: "array",
            description: "Atomic text edit operations for patch mode",
            items: { type: "object" },
          },
          path: { type: "string", description: "Target directory path (for create, default /wiki/) or document path" },
          tags: { type: "array", items: { type: "string" } },
          expected_version: { type: "integer", description: "Optimistic lock expected version" },
          expected_content_hash: { type: "string", description: "Optimistic lock expected content_hash" },
          dry_run: { type: "boolean", description: "Preview patch without persisting" },
        },
        required: [],
      },
    },
    async (args) => writeToolHandler(workspace, db, args, activity),
  );

  register(
    {
      name: "delete",
      description:
        "Delete a single document from the knowledge vault (recorded in change_sets for rollback). Protected system pages cannot be deleted.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Document ID, relative_path, or title to delete" },
        },
        required: ["path"],
      },
    },
    async (args) => deleteToolHandler(db, args, activity),
  );

  register(
    {
      name: "move",
      description:
        "Move or rename a wiki page to another folder while preserving document ID, history, and rewriting explicit path links.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document ID or relative_path" },
          target_folder: { type: "string", description: "Target folder relative to wiki/ (e.g. AI工程/Agent)" },
          filename: { type: "string", description: "Optional new filename (e.g. new-name.md)" },
        },
        required: ["id", "target_folder"],
      },
    },
    async (args) => moveToolHandler(db, args, activity),
  );

  register(
    {
      name: "folder",
      description:
        "Manage wiki folders: list, create, update metadata, move subtree, or delete (empty/move_to_parent/cascade).",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "create", "update", "move", "delete"] },
          path: { type: "string", description: "Folder path relative to wiki/" },
          to_path: { type: "string", description: "Destination path for move action" },
          display_name: { type: "string" },
          description: { type: "string" },
          sort_order: { type: "integer" },
          mode: { type: "string", enum: ["empty", "move_to_parent", "cascade"], default: "empty" },
          target_folder: { type: "string" },
          on_conflict: {
            type: "string",
            enum: ["fail", "merge"],
            default: "fail",
            description: "Conflict policy for move action (fail or merge)",
          },
        },
        required: ["action"],
      },
    },
    async (args) => folderToolHandler(db, args, activity),
  );

  register(
    {
      name: "archive",
      description:
        "Archive a wiki page in-place (sets archived_at/archive_reason in frontmatter, preserves path and history, excludes from default search).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document ID, relative_path, or title" },
          reason: { type: "string", description: "Reason for archiving" },
          superseded_by: { type: "string", description: "Optional replacement page wikilink" },
        },
        required: ["id", "reason"],
      },
    },
    async (args) => archiveToolHandler(db, args, activity),
  );

  register(
    {
      name: "reopen",
      description:
        "Reopen an archived wiki page in-place (clears archived_at/archive_reason, optionally updates confidence/last_verified/review_after).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document ID, relative_path, or title" },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          last_verified: { type: "string" },
          review_after: { type: "string" },
        },
        required: ["id"],
      },
    },
    async (args) => reopenToolHandler(db, args, activity),
  );

  register(
    {
      name: "batch_read",
      description:
        "Batch read multiple wiki documents by IDs or relative paths (fields: meta, content, or outline).",
      inputSchema: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" } },
          paths: { type: "array", items: { type: "string" } },
          fields: { type: "string", enum: ["meta", "content", "outline"], default: "content" },
        },
        required: [],
      },
    },
    async (args) => batchReadToolHandler(db, args),
  );

  register(
    {
      name: "batch_write",
      description:
        "Execute up to 100 wiki document operations (create, replace, patch, update_meta, move, archive, reopen, delete) atomically in a single change_set, with optional dry_run.",
      inputSchema: {
        type: "object",
        properties: {
          ops: { type: "array", items: { type: "object" } },
          summary: { type: "string" },
          dry_run: { type: "boolean", default: false },
        },
        required: ["ops"],
      },
    },
    async (args) => batchWriteToolHandler(db, args),
  );

  registerArchiveTools(register, workspace, db);

  register(
    {
      name: "ping",
      description: "Test connectivity",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    async () => "pong",
  );
}

async function guideText(db: Store): Promise<string> {
  let output = "# LLM Wiki Guide\n\n";
  output += "## Architecture\n\n";
  output +=
    "LLM Wiki is a PostgreSQL-backed knowledge workspace with full-text & vector search,\nautomatic chunking, revision history (change_sets), and reference graph tracking.\n\n";
  output += workspaceLayoutSummary();
  output += "\n## Knowledge Base Status (PostgreSQL SSOT)\n\n";

  try {
    const [folders, docs, archives] = await Promise.all([
      db.listFolders(true).catch(() => []),
      db.listDocumentsFiltered({ archived: "exclude" }),
      typeof db.listArchiveFiles === "function" ? db.listArchiveFiles().catch(() => []) : Promise.resolve([]),
    ]);
    const wikiDocs = docs.filter((d) => d.source_kind === "wiki");
    output += `- **Active Wiki Pages**: ${wikiDocs.length}\n`;
    output += `- **Topic Folders**: ${folders.length}\n`;
    output += `- **Archive Files**: ${archives.length}\n\n`;
    if (folders.length > 0) {
      output += "### Topic Folders\n";
      for (const folder of folders.slice(0, 30)) {
        const label = folder.display_name ? `${folder.path} (${folder.display_name})` : folder.path;
        output += `- \`wiki/${label}\` — ${folder.total_count} pages\n`;
      }
      if (folders.length > 30) output += `- ...and ${folders.length - 30} more folders\n`;
      output += "\n";
    }
  } catch {
    output += "(database summary unavailable)\n\n";
  }

  output += "## Available Tools\n\n";
  output += "- **search** — Hybrid/keyword/exact/regex search, list, reference graph, or lint across Wiki & Archives\n";
  output += "- **read / batch_read** — Read one or many documents by path or ID (with line range or outline_only)\n";
  output += "- **write / batch_write** — Create, replace, patch (atomic edits + optimistic lock), or batch-mutate wiki pages\n";
  output += "- **delete / move / folder / archive / reopen** — Lifecycle and folder hierarchy management\n";
  output += "- **archive_list / archive_read / archive_search / archive_patch / archive_batch** — Raw Archive search, read, patch & batch operations\n";
  output += "- **audit / structure / gaps / similar** — DB-native diagnostics\n";
  output += "- **ping** — Test connectivity\n";
  return output;
}

async function searchToolHandler(
  workspace: string,
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  if (!db) return "Error: database not connected";
  return executeLocalSearch(workspace, db, args);
}

function formatDocument(doc: Document): string {
  let output = `# ${doc.title}\n`;
  output += `Document ID: ${doc.id}\n`;
  output += `Path: ${doc.relative_path}\n`;
  output += `Type: ${doc.file_type}  Status: ${doc.status}  Version: ${doc.version}\n\n`;
  if (doc.tags.length > 0) output += `Tags: ${doc.tags.join(", ")}\n`;
  output += `---\n\n${doc.content}`;
  return output;
}

async function writeToolHandler(
  _workspace: string,
  db: Store,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const idOrPath = typeof args["id"] === "string" ? args["id"].trim() : "";
  const requestedPath = typeof args["path"] === "string" ? args["path"].trim() : "";
  const rawMode = typeof args["mode"] === "string" ? args["mode"].trim().toLowerCase() : "";
  const edits = Array.isArray(args["edits"]) ? (args["edits"] as TextEdit[]) : undefined;
  const mode = rawMode || (edits ? "patch" : "create");
  const expectedVersion =
    typeof args["expected_version"] === "number" && Number.isFinite(args["expected_version"])
      ? args["expected_version"]
      : undefined;
  const expectedHash =
    typeof args["expected_content_hash"] === "string" ? args["expected_content_hash"].trim() : "";
  const dryRun = args["dry_run"] === true;

  if (mode === "patch" || mode === "append") {
    const targetRef = idOrPath || requestedPath;
    if (!targetRef) return "Error: id or path is required for patch/append mode";
    const existing = await resolveDocumentByIdOrPath(db, targetRef);
    if (!existing) return `Document not found: ${targetRef}`;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      return `Error: VERSION_CONFLICT (expected ${expectedVersion}, current ${existing.version}, content_hash=${existing.content_hash})`;
    }
    if (expectedHash && existing.content_hash !== expectedHash) {
      return `Error: VERSION_CONFLICT (expected hash ${expectedHash}, current ${existing.content_hash}, version=${existing.version})`;
    }
    const patchEdits: TextEdit[] =
      mode === "append"
        ? [{ op: "append", text: typeof args["content"] === "string" ? args["content"] : "" }]
        : (edits ?? []);
    let patched;
    try {
      patched = applyTextEdits(existing.content ?? "", patchEdits);
    } catch (error) {
      if (error instanceof TextPatchError) {
        return `Error: ${error.code} (${error.status}) - ${error.message}`;
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (dryRun) {
      return `Dry-run OK: ${existing.relative_path} (applied_edits=${patched.applied_edits}, changed=${patched.changed}, line_delta=${patched.line_delta})\n---\n${patched.content}`;
    }
    const norm = normalizeWikiContent(patched.content, existing.source_kind || "wiki", existing.file_type || "md");
    const doc = await pageDocument(db, existing.relative_path, Buffer.from(norm.content, "utf8"));
    doc.id = existing.id;
    doc.version = existing.version;
    await db.applyChangeSet(
      {
        id: randomUUID(),
        kind: "manual",
        summary: `mcp ${mode} ${existing.relative_path}`,
        page_count: 1,
        created_at: "",
      },
      [
        {
          relative_path: existing.relative_path,
          document: doc,
          operation: "update",
          chunks: buildPageChunks(doc.id, norm.content),
          refs: [],
        },
      ],
    );
    const extracted = new Map<string, ExtractedReferenceEntry[]>([[existing.relative_path, norm.entries]]);
    await storeReferenceEntries(db, extracted, new Set([existing.relative_path])).catch(() => {});
    await rebuildReferences(db, [existing.relative_path]).catch(() => {});
    await activity?.logDocument(db, "updated", doc.id, existing.relative_path, "mcp");
    return `Patched: ${doc.title || doc.filename} (ID: ${doc.id}, path: ${existing.relative_path}, applied_edits=${patched.applied_edits}, line_delta=${patched.line_delta})`;
  }

  const title = typeof args["title"] === "string" ? args["title"] : "";
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const tags = Array.isArray(args["tags"])
    ? args["tags"].filter((item): item is string => typeof item === "string")
    : [];

  let relPath = "";
  let existing: Document | null = null;
  if (mode === "replace" && idOrPath) {
    existing = await resolveDocumentByIdOrPath(db, idOrPath);
    if (!existing) return `Document not found: ${idOrPath}`;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      return `Error: VERSION_CONFLICT (expected ${expectedVersion}, current ${existing.version})`;
    }
    if (expectedHash && existing.content_hash !== expectedHash) {
      return `Error: VERSION_CONFLICT (expected hash ${expectedHash}, current ${existing.content_hash})`;
    }
    relPath = existing.relative_path;
  } else {
    if (!title.trim()) return "Error: title is required for create mode";
    let dirPath = "/wiki/";
    if (requestedPath) {
      let normalized = requestedPath;
      if (!normalized.startsWith("/")) normalized = `/${normalized}`;
      if (!normalized.endsWith("/")) normalized = `${normalized}/`;
      dirPath = normalized;
    }
    const filename = `${title.toLowerCase().replace(/ /g, "-")}.md`;
    relPath = `${dirPath.replace(/^\/+/, "")}${filename}`;
    try {
      validateWikiWritePath(relPath);
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
    existing = (await db.getDocumentByRelativePath(relPath)) ?? (await db.getDocumentByPath(filename, dirPath));
    if (existing) {
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        return `Error: VERSION_CONFLICT (expected ${expectedVersion}, current ${existing.version})`;
      }
      if (expectedHash && existing.content_hash !== expectedHash) {
        return `Error: VERSION_CONFLICT (expected hash ${expectedHash}, current ${existing.content_hash})`;
      }
    }
  }

  const norm = normalizeWikiContent(content, "wiki", "md");
  const doc = await pageDocument(db, relPath, Buffer.from(norm.content, "utf8"));
  if (title.trim()) doc.title = title.trim();
  else if (existing?.title) doc.title = existing.title;
  if (tags.length > 0) doc.tags = tags;
  else if (existing?.tags?.length) doc.tags = existing.tags;
  if (!doc.id) doc.id = existing?.id || randomUUID();

  const operation = existing ? "update" : "create";
  await db.applyChangeSet(
    {
      id: randomUUID(),
      kind: "manual",
      summary: `mcp write ${relPath}`,
      page_count: 1,
      created_at: "",
    },
    [
      {
        relative_path: relPath,
        document: doc,
        operation,
        chunks: buildPageChunks(doc.id, norm.content),
        refs: [],
      },
    ],
  );
  const extracted = new Map<string, ExtractedReferenceEntry[]>([[relPath, norm.entries]]);
  await storeReferenceEntries(db, extracted, new Set(existing ? [relPath] : [])).catch(() => {});
  await rebuildReferences(db, [relPath]).catch(() => {});
  await activity?.logDocument(db, existing ? "updated" : "created", doc.id, relPath, "mcp");
  return existing
    ? `Updated: ${doc.title} (ID: ${doc.id}, path: ${relPath})`
    : `Created: ${doc.title} (ID: ${doc.id}, path: ${relPath})`;
}

async function deleteToolHandler(
  db: Store,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const requested = typeof args["path"] === "string" ? args["path"].trim() : "";
  if (!requested) return "Error: path is required";
  const doc = await resolveDocumentByIdOrPath(db, requested);
  if (!doc) return `Document not found: ${requested}`;
  const relPath =
    doc.relative_path || `${doc.path.replace(/\/+$/, "")}/${doc.filename}`.replace(/^\/+/, "");
  if (RESERVED_TOP_LEVEL_WIKI_PAGES.has(relPath) || isWikiSystemPath(relPath)) {
    return `Error: cannot delete protected system page: ${relPath}`;
  }
  await db.applyChangeSet(
    {
      id: randomUUID(),
      kind: "manual",
      summary: `mcp delete ${relPath}`,
      page_count: 1,
      created_at: "",
    },
    [{ relative_path: relPath, document: null, operation: "delete", chunks: [], refs: [] }],
  );
  const folder = folderPathFromWikiRelPath(relPath);
  if (folder) {
    await refreshFolderOverviews(db, [folder]).catch(() => undefined);
  }
  await activity?.logDocument(db, "deleted", doc.id, relPath, "mcp");
  return `Deleted document: ${doc.title || doc.filename} (ID: ${doc.id}, path: ${relPath})`;
}

async function moveToolHandler(
  db: Store,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const idOrPath = typeof args["id"] === "string" ? args["id"].trim() : "";
  const targetFolder = typeof args["target_folder"] === "string" ? args["target_folder"].trim() : "";
  const filename = typeof args["filename"] === "string" ? args["filename"].trim() : undefined;
  if (!idOrPath || !targetFolder) return "Error: id and target_folder are required";

  const doc = await resolveDocByRef(db, idOrPath);
  if (!doc) return `Document not found: ${idOrPath}`;

  try {
    const result = await db.moveDocument(doc.id, targetFolder, filename, "mcp");
    const toRebuild = [...new Set([result.document.relative_path, ...result.updated_link_paths])].filter(Boolean);
    if (toRebuild.length > 0) {
      await rebuildReferences(db, toRebuild).catch(() => undefined);
    }
    const affectedFolders = [
      folderPathFromWikiRelPath(result.old_relative_path),
      folderPathFromWikiRelPath(result.document.relative_path),
    ].filter(Boolean);
    if (affectedFolders.length > 0) {
      await refreshFolderOverviews(db, [...new Set(affectedFolders)]).catch(() => undefined);
    }
    await activity?.logDocument(db, "moved", doc.id, result.document.relative_path, "mcp");
    return `Moved: ${result.old_relative_path} -> ${result.document.relative_path} (updated ${result.updated_link_paths.length} backlink(s))`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function folderToolHandler(
  db: Store,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const action = typeof args["action"] === "string" ? args["action"].trim() : "";
  const folderPath = typeof args["path"] === "string" ? args["path"].trim() : "";

  try {
    switch (action) {
      case "list": {
        const folders = await db.listFolders(true);
        if (folders.length === 0) return "No folders found.";
        return folders
          .map((f) => `- ${f.path}/ (${f.display_name || f.path}, ${f.total_count} pages)${f.description ? ` — ${f.description}` : ""}`)
          .join("\n");
      }
      case "create": {
        if (!folderPath) return "Error: path is required";
        const created = await db.createFolder({
          path: folderPath,
          display_name: typeof args["display_name"] === "string" ? args["display_name"] : undefined,
          description: typeof args["description"] === "string" ? args["description"] : undefined,
          sort_order: typeof args["sort_order"] === "number" ? args["sort_order"] : undefined,
        });
        return `Created folder: ${created.path}`;
      }
      case "update": {
        if (!folderPath) return "Error: path is required";
        const updated = await db.updateFolder(folderPath, {
          display_name: typeof args["display_name"] === "string" ? args["display_name"] : undefined,
          description: typeof args["description"] === "string" ? args["description"] : undefined,
          sort_order: typeof args["sort_order"] === "number" ? args["sort_order"] : undefined,
        });
        if (!updated) return `Folder not found: ${folderPath}`;
        return `Updated folder: ${updated.path}`;
      }
      case "move": {
        const toPath = typeof args["to_path"] === "string" ? args["to_path"].trim() : "";
        if (!folderPath || !toPath) return "Error: path and to_path are required";
        const rawConflict = typeof args["on_conflict"] === "string" ? args["on_conflict"].trim().toLowerCase() : "fail";
        if (rawConflict !== "fail" && rawConflict !== "merge") {
          return "Error: on_conflict must be fail or merge";
        }
        const result = await db.moveFolder(folderPath, toPath, "mcp", {
          onConflict: rawConflict as "fail" | "merge",
        });
        const toRebuild = [...new Set([...result.moved_doc_paths, ...result.updated_link_paths])].filter(Boolean);
        if (toRebuild.length > 0) {
          await rebuildReferences(db, toRebuild).catch(() => undefined);
        }
        await refreshFolderOverviews(db, [result.to_path]).catch(() => undefined);
        return `Moved folder: ${result.from_path} -> ${result.to_path} (${result.moved_folders} folders, ${result.moved_documents} docs)`;
      }
      case "delete": {
        if (!folderPath) return "Error: path is required";
        const mode = (typeof args["mode"] === "string" ? args["mode"] : "empty") as "empty" | "move_to_parent" | "cascade";
        const targetFolder = typeof args["target_folder"] === "string" ? args["target_folder"] : "";
        const result = await db.deleteFolder(folderPath, mode, targetFolder, "mcp");
        if (mode === "move_to_parent") {
          const fallbackTarget = targetFolder.trim() || (folderPath.includes("/") ? folderPath.slice(0, folderPath.lastIndexOf("/")) : "");
          if (fallbackTarget) {
            await refreshFolderOverviews(db, [fallbackTarget]).catch(() => undefined);
          }
        }
        await activity?.logDocument(db, "folder_deleted", folderPath, `wiki/${result.path}`, "mcp");
        return `Deleted folder: ${result.path} (mode=${result.mode}, moved=${result.moved_documents}, deleted=${result.deleted_documents})`;
      }
      default:
        return `Unknown folder action: ${action}`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function resolveDocByRef(db: Store, ref: string): Promise<Document | null> {
  let doc = await db.getDocument(ref);
  if (!doc) doc = await db.getDocumentByRelativePath(ref.replace(/^\/+/, ""));
  if (!doc) doc = await db.findDocumentByName(ref);
  return doc;
}

async function archiveToolHandler(
  db: Store,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const idOrPath = typeof args["id"] === "string" ? args["id"].trim() : "";
  const reason = typeof args["reason"] === "string" ? args["reason"].trim() : "";
  const supersededBy = typeof args["superseded_by"] === "string" ? args["superseded_by"].trim() : undefined;
  if (!idOrPath || !reason) return "Error: id and reason are required";
  const doc = await resolveDocByRef(db, idOrPath);
  if (!doc) return `Document not found: ${idOrPath}`;
  try {
    const archived = buildArchivedDocument(doc, { reason, supersededBy });
    await db.applyChangeSet(
      { id: randomUUID(), kind: "manual", summary: `archive page: ${reason}`, page_count: 1, created_at: "" },
      [{ relative_path: archived.relative_path, document: archived, operation: "archive", chunks: buildPageChunks(archived.id, archived.content), refs: [] }],
    );
    await activity?.logDocument(db, "archived", archived.id, archived.relative_path, "mcp");
    return `Archived: ${archived.relative_path} (archived_at=${archived.archived_at})`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function reopenToolHandler(
  db: Store,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const idOrPath = typeof args["id"] === "string" ? args["id"].trim() : "";
  if (!idOrPath) return "Error: id is required";
  const doc = await resolveDocByRef(db, idOrPath);
  if (!doc) return `Document not found: ${idOrPath}`;
  try {
    const reopened = buildReopenedDocument(doc, {
      reason: typeof args["reason"] === "string" ? args["reason"] : undefined,
      confidence: typeof args["confidence"] === "string" ? args["confidence"] : undefined,
      lastVerified: typeof args["last_verified"] === "string" ? args["last_verified"] : undefined,
      reviewAfter: typeof args["review_after"] === "string" ? args["review_after"] : undefined,
    });
    await db.applyChangeSet(
      { id: randomUUID(), kind: "manual", summary: "reopen page", page_count: 1, created_at: "" },
      [{ relative_path: reopened.relative_path, document: reopened, operation: "reopen", chunks: buildPageChunks(reopened.id, reopened.content), refs: [] }],
    );
    await activity?.logDocument(db, "reopened", reopened.id, reopened.relative_path, "mcp");
    return `Reopened: ${reopened.relative_path}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function batchReadToolHandler(db: Store, args: Record<string, unknown>): Promise<string> {
  if (!db) return "Error: database not connected";
  const ids = Array.isArray(args["ids"]) ? (args["ids"] as unknown[]).map((v) => String(v).trim()).filter(Boolean) : [];
  const paths = Array.isArray(args["paths"]) ? (args["paths"] as unknown[]).map((v) => String(v).trim()).filter(Boolean) : [];
  if (ids.length === 0 && paths.length === 0) return "Error: ids or paths is required";
  if (ids.length + paths.length > MAX_BATCH_GET) return `Error: total items exceeds ${MAX_BATCH_GET}`;
  const fields = typeof args["fields"] === "string" ? args["fields"] : "content";

  const seen = new Set<string>();
  const lines: string[] = [];
  const notFound: string[] = [];

  const appendDoc = (doc: Document) => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    const content = doc.content ?? "";
    if (fields === "meta") {
      lines.push(`- [${doc.id}] ${doc.relative_path} (v${doc.version}, ${[...content].length} chars) — ${doc.title}`);
    } else if (fields === "outline") {
      const headings = extractMarkdownOutline(content);
      lines.push(`## [${doc.id}] ${doc.relative_path}\n${headings.join("\n") || "(no headings)"}`);
    } else {
      lines.push(`## [${doc.id}] ${doc.relative_path} (v${doc.version})\n\n${content}`);
    }
  };

  for (const id of ids) {
    const doc = await db.getDocument(id);
    if (!doc) notFound.push(id);
    else appendDoc(doc);
  }
  for (const p of paths) {
    const clean = p.replace(/^\/+/, "");
    let doc = await db.getDocumentByRelativePath(clean);
    if (!doc && !clean.startsWith("wiki/")) doc = await db.getDocumentByRelativePath(`wiki/${clean}`);
    if (!doc) notFound.push(p);
    else appendDoc(doc);
  }

  return [
    `Found ${seen.size} document(s)${notFound.length ? `, not_found: ${notFound.join(", ")}` : ""}`,
    "",
    ...lines,
  ].join("\n");
}

async function batchWriteToolHandler(db: Store, args: Record<string, unknown>): Promise<string> {
  if (!db) return "Error: database not connected";
  const ops = Array.isArray(args["ops"]) ? (args["ops"] as BatchDocOp[]) : [];
  const summary = typeof args["summary"] === "string" ? args["summary"] : undefined;
  const dryRun = args["dry_run"] === true;
  try {
    const res = await executeWikiBatch(db, { ops, summary, dry_run: dryRun }, "mcp");
    if (res.dry_run) {
      return `Dry-run OK: ${res.op_count} op(s), ${res.affected_pages} affected page(s), rewritten_links=${res.rewritten_link_pages.length}`;
    }
    return `Batch applied: change_set=${res.change_set_id}, ops=${res.op_count}, affected=${res.affected_pages}, rewritten_links=${res.rewritten_link_pages.length}`;
  } catch (error) {
    if (error instanceof BatchOperationError) {
      return `Error: ${error.code} (${error.status}) - ${error.message}`;
    }
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
