import {
  LINT_SEVERITY_ERROR,
  LINT_SEVERITY_INFO,
  LINT_SEVERITY_WARNING,
  type LintReport,
} from "../engine/lint_types.js";
import { lintDocuments, lintWorkspace } from "../engine/lint.js";
import type { ToolLoopConfig } from "../llm/types.js";
import type { Store } from "../store/interfaces.js";
import type { ArchiveFilter, SearchOptions } from "../store/types.js";
import type { Tool } from "./types.js";
import {
  executeLocalAudit,
  executeLocalGaps,
  executeLocalSimilar,
  executeLocalStructure,
  auditTool,
  gapsTool,
  similarTool,
  structureTool,
} from "./diagnostic_tools.js";
import { executeWebFetch, webFetchTool } from "./web_fetch.js";

export const searchTool: Tool = {
  name: "search",
  description: "Browse or search the knowledge vault. Modes: list, search, references, lint.",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["list", "search", "references", "lint"], default: "list" },
      query: { type: "string", default: "" },
      path: { type: "string", default: "*" },
      limit: { type: "integer", default: 10 },
      types: { type: "array", items: { type: "string" } },
      kinds: { type: "array", items: { type: "string" } },
      statuses: { type: "array", items: { type: "string" } },
      confidences: { type: "array", items: { type: "string" } },
      archived: { type: "string", enum: ["exclude", "include", "only"], default: "exclude" },
    },
    required: [],
  },
};

export const readTool: Tool = {
  name: "read",
  description: "Read a document from the knowledge vault by path or document id.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the document to read" },
    },
    required: ["path"],
  },
};

export const referencesTool: Tool = {
  name: "references",
  description:
    "Query the citation and link graph for a document. Returns backlinks (pages linking to this page) and forward references (pages this page links to).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Document ID or path to query references for" },
    },
    required: ["query"],
  },
};

export function builtinReadonlyToolDefinitions(): Tool[] {
  return [searchTool, readTool, webFetchTool];
}

export function builtinToolDefinitionsForMode(mode: string): Tool[] {
  const base = [searchTool, readTool, webFetchTool];
  switch (mode) {
    case "qa":
      return [...base, referencesTool];
    case "organize":
      return [...base, referencesTool, auditTool, structureTool, gapsTool, similarTool];
    default:
      return base;
  }
}

export function toolLoopConfigForMode(mode: string): ToolLoopConfig {
  switch (mode) {
    case "qa":
      return { maxRounds: 6, maxToolCallsPerRound: 4 };
    case "organize":
      return { maxRounds: 12, maxToolCallsPerRound: 4 };
    default:
      return { maxRounds: 8, maxToolCallsPerRound: 4 };
  }
}

export function toolTemperatureForMode(mode: string): number {
  switch (mode) {
    case "qa":
      return 0.5;
    case "organize":
      return 0.6;
    default:
      return 0.7;
  }
}

export function toolMaxTokensForMode(mode: string): number {
  return mode === "organize" ? 3072 : 2048;
}

export function toolChoiceForMode(mode: string, round: number): string {
  return mode === "organize" && round === 0 ? "required" : "";
}

export async function executeLocalReadonlyTool(
  workspace: string,
  db: Store,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name.trim().toLowerCase()) {
    case "web_fetch":
      return executeWebFetch(workspace, args);
    case "search":
      if (!db) return "Error: database not connected";
      return executeLocalSearch(workspace, db, args);
    case "read":
      if (!db) return "Error: database not connected";
      return executeLocalRead(db, args);
    case "references":
      if (!db) return "Error: database not connected";
      return executeLocalReferences(db, args);
    case "audit":
      if (!db) return "Error: database not connected";
      return executeLocalAudit(workspace, db, args);
    case "structure":
      if (!db) return "Error: database not connected";
      return executeLocalStructure(workspace, db);
    case "gaps":
      if (!db) return "Error: database not connected";
      return executeLocalGaps(workspace, db, args);
    case "similar":
      if (!db) return "Error: database not connected";
      return executeLocalSimilar(db, args);
    default:
      throw new Error(`unknown local tool ${JSON.stringify(name)}`);
  }
}

export async function executeLocalSearch(
  workspace: string,
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  const mode = typeof args["mode"] === "string" && args["mode"] ? args["mode"] : "list";
  const limit = typeof args["limit"] === "number" ? args["limit"] : 10;
  let pathFilter = "";
  const rawPath = typeof args["path"] === "string" ? args["path"] : "";
  if (rawPath === "wiki" || rawPath === "wiki/") pathFilter = "wiki";
  else if (rawPath === "sources" || rawPath === "raw/sources") pathFilter = "sources";

  const strArray = (key: string): string[] =>
    Array.isArray(args[key])
      ? (args[key] as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "")
      : [];
  const rawArchived = typeof args["archived"] === "string" ? args["archived"].trim().toLowerCase() : "";
  const archived: ArchiveFilter =
    rawArchived === "include" || rawArchived === "only" || rawArchived === "exclude"
      ? rawArchived
      : "exclude";
  const searchOptions: SearchOptions = {
    page_types: strArray("types"),
    experience_kinds: strArray("kinds"),
    statuses: strArray("statuses"),
    confidences: strArray("confidences"),
    archived,
  };

  switch (mode) {
    case "list": {
      const docs = await db.listDocumentsFiltered({
        page_types: searchOptions.page_types,
        experience_kinds: searchOptions.experience_kinds,
        statuses: searchOptions.statuses,
        confidences: searchOptions.confidences,
        archived,
      });
      if (docs.length === 0) return "No documents found.";
      let output = `Found ${docs.length} documents:\n\n`;
      for (const doc of docs) {
        const meta = [doc.page_type, doc.experience_kind, doc.page_status, doc.confidence]
          .filter(Boolean)
          .join("/");
        const archivedTag = doc.archived_at ? ` [archived:${doc.archived_at}]` : "";
        output += `- **${doc.title || doc.filename}** — \`${doc.relative_path}\` [${meta || doc.file_type}]${archivedTag}\n`;
      }
      return output;
    }
    case "search": {
      const query = typeof args["query"] === "string" ? args["query"] : "";
      if (!query.trim()) return "Error: query is required for search mode";
      const results = await db.searchChunks(query, limit, pathFilter, searchOptions);
      if (results.length === 0) return `No results found for: ${query}`;
      let output = `Found ${results.length} results for "${query}":\n\n`;
      for (const result of results) {
        const meta = [result.page_type, result.experience_kind, result.page_status, result.confidence]
          .filter(Boolean)
          .join("/");
        output += `### ${result.title || result.filename} (${result.path}) [${meta ? `${meta} · ` : ""}score: ${result.score.toFixed(2)}]\n`;
        if (result.header_breadcrumb) output += `Section: ${result.header_breadcrumb}\n`;
        if (result.symptoms && result.symptoms.length > 0) {
          output += `Symptoms: ${result.symptoms.join(", ")}\n`;
        }
        output += `${result.content}\n\n---\n\n`;
      }
      return output;
    }
    case "references":
      return executeLocalReferences(db, args);
    case "lint": {
      if (!db) return "Error: database not connected";
      const report = await lintDocuments(db);
      return formatLintMcp(report);
    }
    default:
      return `Unknown mode: ${mode}`;
  }
}

export async function executeLocalReferences(
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  const query = typeof args["query"] === "string" ? args["query"] : "";
  if (!query.trim()) return "Error: query (document ID) is required for references mode";
  const backlinks = await db.getBacklinks(query);
  const forward = await db.getForwardReferences(query);
  let output = `Backlinks (${backlinks.length}):\n`;
  for (const link of backlinks) {
    output += `  ← ${link.title} [${link.path}] (${link.reference_type})\n`;
  }
  output += `\nForward references (${forward.length}):\n`;
  for (const link of forward) {
    output += `  → ${link.title} [${link.path}] (${link.reference_type})\n`;
  }
  return output;
}

export async function executeLocalRead(db: Store, args: Record<string, unknown>): Promise<string> {
  const requested = typeof args["path"] === "string" ? args["path"] : "";
  if (!requested.trim()) return "Error: path is required";
  let doc = await db.getDocument(requested);
  if (!doc) doc = await db.findDocumentByName(requested);
  if (!doc) return `Document not found: ${requested}`;
  let output = `# ${doc.title}\n`;
  output += `Path: ${doc.relative_path}\n`;
  output += `Type: ${doc.file_type}  Status: ${doc.status}  Version: ${doc.version}\n\n`;
  if (doc.tags.length > 0) output += `Tags: ${doc.tags.join(", ")}\n`;
  output += `---\n\n${doc.content}`;
  return output;
}

export function formatLintMcp(report: LintReport): string {
  let errors = 0;
  let warnings = 0;
  for (const issue of report.issues) {
    if (issue.severity === LINT_SEVERITY_ERROR) errors += 1;
    else if (issue.severity === LINT_SEVERITY_WARNING) warnings += 1;
  }
  let output = `# Wiki Lint\n\n${errors} 错误, ${warnings} 警告\n\n`;
  output += `统计：${report.stats.page_count} 页（活跃 ${report.stats.active} / 已归档 ${report.stats.archived}）, ${report.stats.source_count} 源文件`;
  if (report.stats.review_overdue > 0) output += `, 待复审 ${report.stats.review_overdue} 页`;
  if (report.stats.last_updated) output += `, 最后更新 ${report.stats.last_updated}`;
  output += "\n\n";

  for (const severity of [LINT_SEVERITY_ERROR, LINT_SEVERITY_WARNING, LINT_SEVERITY_INFO]) {
    const group = report.issues.filter((issue) => issue.severity === severity);
    if (group.length === 0) continue;
    output += `## ${severity} (${group.length})\n\n`;
    for (const issue of group) {
      const location = issue.line && issue.line > 0 ? `${issue.path}:${issue.line}` : issue.path;
      output += `- **${issue.code}** \`${location}\` — ${issue.message}\n`;
    }
    output += "\n";
  }
  if (report.issues.length === 0) output += "未发现问题。\n";
  return output;
}
