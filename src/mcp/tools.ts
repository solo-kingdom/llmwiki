import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceFileIndexer } from "../engine/file_indexer.js";
import { parseFrontmatter } from "../engine/frontmatter.js";
import { resolvePageType, validateWikiWritePath } from "../engine/wiki_org.js";
import { workspaceLayoutSummary } from "../engine/workspace_layout.js";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { formatLintMcp } from "./local_tools.js";
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
  registerTools(server, workspace, db, null, activity);
  await server.runStdio();
}

export function registerTools(
  server: McpServer,
  workspace: string,
  db: Store,
  indexer: WorkspaceFileIndexer | null,
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
    async () => guideText(workspace),
  );

  register(
    {
      name: "search",
      description:
        "Browse or search the knowledge vault. Modes: list (browse files), search (keyword search), references (citation graph), lint (wiki health checks).",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["list", "search", "references", "lint"], default: "list" },
          query: { type: "string", default: "" },
          path: { type: "string", default: "*" },
          limit: { type: "integer", default: 10 },
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
        "Read a document from the knowledge vault. Supports markdown, PDF (by page), images, and batch glob reads.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the document to read" },
          pages: { type: "string", description: "Page range (e.g. '1-5,10')" },
        },
        required: ["path"],
      },
    },
    async (args) => {
      if (!db) return "Error: database not connected";
      const requested = typeof args["path"] === "string" ? args["path"] : "";
      if (!requested) return "Error: path is required";
      let doc = await db.getDocument(requested);
      if (!doc) doc = await db.findDocumentByName(requested);
      if (!doc) return `Document not found: ${requested}`;
      return formatDocument(doc);
    },
  );

  register(
    {
      name: "write",
      description:
        "Create or edit a wiki page. Use create for new pages, edit for str_replace modification, append to add content.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Page title" },
          content: { type: "string", description: "Page content with YAML frontmatter" },
          path: { type: "string", description: "Target path (default /wiki/)" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "content"],
      },
    },
    async (args) => writeToolHandler(workspace, db, indexer, args, activity),
  );

  register(
    {
      name: "delete",
      description:
        "Delete a document from the knowledge vault. Supports path and glob patterns. Protected pages (overview.md, log.md) cannot be deleted.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path or glob pattern to delete" },
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
        },
        required: ["action"],
      },
    },
    async (args) => folderToolHandler(db, args, activity),
  );

  register(
    {
      name: "ping",
      description: "Test connectivity",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    async () => "pong",
  );
}

async function guideText(workspace: string): Promise<string> {
  let output = "# LLM Wiki Guide\n\n";
  output += "## Architecture\n\n";
  output +=
    "LLM Wiki is a knowledge management system that indexes documents\ninto a searchable SQLite-backed vault with full-text search,\nautomatic chunking, and reference graph tracking.\n\n";
  output += workspaceLayoutSummary();
  output += "\n## Workspaces\n\n";

  const wikiDir = path.join(workspace, "wiki");
  const sourcesDir = path.join(workspace, "raw", "sources");

  try {
    const entries = await readdir(wikiDir);
    output += `### Wiki Pages (${entries.length} files)\n`;
    for (const entry of entries) {
      if (entry.endsWith(".md")) output += `- ${entry}\n`;
    }
    output += "\n";
  } catch {
    output += "### Wiki Pages\n(directory not found)\n\n";
  }

  try {
    const entries = await readdir(sourcesDir);
    output += `### Source Documents (${entries.length} files)\n`;
    for (const entry of entries) output += `- ${entry}\n`;
    output += "\n";
  } catch {
    output += "### Source Documents\n(directory not found)\n\n";
  }

  output += "## Available Tools\n\n";
  output += "- **search** — Full-text search across all indexed documents\n";
  output += "- **read** — Read a document by path or ID\n";
  output += "- **write** — Create or update a wiki page\n";
  output += "- **delete** — Remove a document from the vault\n";
  output += "- **ping** — Test connectivity\n";
  return output;
}

async function searchToolHandler(
  workspace: string,
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const mode = typeof args["mode"] === "string" && args["mode"] ? args["mode"] : "list";
  const limit = typeof args["limit"] === "number" ? args["limit"] : 10;
  let pathFilter = "";
  const rawPath = typeof args["path"] === "string" ? args["path"] : "";
  if (rawPath === "wiki" || rawPath === "wiki/") pathFilter = "wiki";
  else if (rawPath === "sources" || rawPath === "raw/sources") pathFilter = "sources";

  switch (mode) {
    case "list": {
      const docs = await db.listDocuments();
      if (docs.length === 0) return "No documents found.";
      let output = `Found ${docs.length} documents:\n\n`;
      for (const doc of docs) {
        output += `- **${doc.title || doc.filename}** — \`${doc.relative_path}\` [${doc.file_type}]\n`;
      }
      return output;
    }
    case "search": {
      const query = typeof args["query"] === "string" ? args["query"] : "";
      if (!query) return "Error: query is required for search mode";
      const results = await db.searchChunks(query, limit, pathFilter);
      if (results.length === 0) return `No results found for: ${query}`;
      let output = `Found ${results.length} results for "${query}":\n\n`;
      for (const result of results) {
        output += `### ${result.title || result.filename} (${result.path}) [score: ${result.score.toFixed(2)}]\n`;
        if (result.header_breadcrumb) output += `Section: ${result.header_breadcrumb}\n`;
        output += `${result.content}\n\n---\n\n`;
      }
      return output;
    }
    case "references": {
      const query = typeof args["query"] === "string" ? args["query"] : "";
      if (!query) return "Error: query (document ID) is required for references mode";
      const backlinks = await db.getBacklinks(query);
      const forward = await db.getForwardReferences(query);
      let output = `Backlinks (${backlinks.length}):\n`;
      for (const link of backlinks) output += `  ← ${link.title} [${link.path}] (${link.reference_type})\n`;
      output += `\nForward references (${forward.length}):\n`;
      for (const link of forward) output += `  → ${link.title} [${link.path}] (${link.reference_type})\n`;
      return output;
    }
    case "lint": {
      if (!workspace) return "Error: workspace not configured";
      const { lintWorkspace } = await import("../engine/lint.js");
      return formatLintMcp(await lintWorkspace(workspace));
    }
    default:
      return `Unknown mode: ${mode}`;
  }
}

function formatDocument(doc: Document): string {
  let output = `# ${doc.title}\n`;
  output += `Path: ${doc.relative_path}\n`;
  output += `Type: ${doc.file_type}  Status: ${doc.status}  Version: ${doc.version}\n\n`;
  if (doc.tags.length > 0) output += `Tags: ${doc.tags.join(", ")}\n`;
  output += `---\n\n${doc.content}`;
  return output;
}

async function writeToolHandler(
  workspace: string,
  db: Store,
  indexer: WorkspaceFileIndexer | null,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const title = typeof args["title"] === "string" ? args["title"] : "";
  const content = typeof args["content"] === "string" ? args["content"] : "";
  let dirPath = "/wiki/";
  const requestedPath = typeof args["path"] === "string" ? args["path"] : "";
  if (requestedPath) {
    let normalized = requestedPath;
    if (!normalized.startsWith("/")) normalized = `/${normalized}`;
    if (!normalized.endsWith("/")) normalized = `${normalized}/`;
    dirPath = normalized;
  }
  const tags = Array.isArray(args["tags"])
    ? args["tags"].filter((item): item is string => typeof item === "string")
    : [];
  const filename = `${title.toLowerCase().replace(/ /g, "-")}.md`;
  const relPath = `${dirPath.replace(/^\/+/, "")}${filename}`;
  try {
    validateWikiWritePath(relPath);
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
  const fm = parseFrontmatter(content);
  const pageType = resolvePageType(fm.type, "", relPath);

  const existing = await db.getDocumentByPath(filename, dirPath);
  if (existing) {
    if (workspace) await writeWikiPageFile(workspace, relPath, content);
    await db.updateDocument(existing.id, content, title, tags, "", "");
    if (indexer) {
      if (workspace) await indexer.indexFile(relPath).catch(() => {});
      else await indexer.indexDocumentContent(existing.id, content).catch(() => {});
    }
    await activity?.logDocument(db, "updated", existing.id, relPath, "mcp");
    return `Updated: ${title} (ID: ${existing.id}, version incremented)`;
  }

  if (workspace) await writeWikiPageFile(workspace, relPath, content);
  const doc: Document = {
    id: "",
    user_id: "",
    filename,
    title,
    path: dirPath,
    relative_path: relPath,
    source_kind: "wiki",
    file_type: "md",
    file_size: 0,
    document_number: 0,
    status: "ready",
    page_count: 0,
    content,
    tags,
    date: "",
    metadata: "",
    error_message: "",
    version: 0,
    parser: "",
    content_hash: "",
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    page_type: pageType,
  };
  await db.createDocument(doc);
  if (indexer) {
    if (workspace) await indexer.indexFile(relPath).catch(() => {});
    else await indexer.indexDocumentContent(doc.id, content).catch(() => {});
  }
  await activity?.logDocument(db, "created", doc.id, relPath, "mcp");
  return `Created: ${title} (ID: ${doc.id}, path: ${relPath})`;
}

async function deleteToolHandler(
  db: Store,
  args: Record<string, unknown>,
  activity?: McpActivity,
): Promise<string> {
  if (!db) return "Error: database not connected";
  const requested = typeof args["path"] === "string" ? args["path"] : "";
  if (!requested) return "Error: path is required";
  const base = path.basename(requested);
  if (base === "overview.md" || base === "log.md") {
    return `Error: cannot delete protected page: ${base}`;
  }
  let doc = await db.findDocumentByName(requested);
  if (!doc) doc = await db.getDocument(requested);
  if (!doc) return `Document not found: ${requested}`;
  const affected = await db.archiveDocuments([doc.id]);
  await activity?.logDocument(db, "deleted", doc.id, doc.relative_path, "mcp");
  return `Deleted ${affected} document(s): ${doc.title} (ID: ${doc.id})`;
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

  let doc = await db.getDocument(idOrPath);
  if (!doc) doc = await db.getDocumentByRelativePath(idOrPath.replace(/^\/+/, ""));
  if (!doc) doc = await db.findDocumentByName(idOrPath);
  if (!doc) return `Document not found: ${idOrPath}`;

  try {
    const result = await db.moveDocument(doc.id, targetFolder, filename, "mcp");
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
        const result = await db.moveFolder(folderPath, toPath, "mcp");
        return `Moved folder: ${result.from_path} -> ${result.to_path} (${result.moved_folders} folders, ${result.moved_documents} docs)`;
      }
      case "delete": {
        if (!folderPath) return "Error: path is required";
        const mode = (typeof args["mode"] === "string" ? args["mode"] : "empty") as "empty" | "move_to_parent" | "cascade";
        const targetFolder = typeof args["target_folder"] === "string" ? args["target_folder"] : "";
        const result = await db.deleteFolder(folderPath, mode, targetFolder, "mcp");
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

async function writeWikiPageFile(workspace: string, relPath: string, content: string): Promise<void> {
  if (!relPath.startsWith("wiki/")) {
    throw new Error(`refusing to write outside wiki/: ${relPath}`);
  }
  const fullPath = path.join(workspace, relPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}
