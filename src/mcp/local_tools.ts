import type { ApiContext } from "../api/context.js";
import { hybridSearchDetailed } from "../api/search.js";
import { lintDocuments } from "../engine/lint.js";
import {
  LINT_SEVERITY_ERROR,
  LINT_SEVERITY_INFO,
  LINT_SEVERITY_WARNING,
  type LintReport,
} from "../engine/lint_types.js";
import type { ToolLoopConfig } from "../llm/types.js";
import type { Store } from "../store/interfaces.js";
import { SearchValidationError, validateSearchRegex } from "../store/postgres/chunks.js";
import type {
  ArchiveFilter,
  ArchiveSearchHit,
  Document,
  SearchChunk,
  SearchMatchMode,
  SearchOptions,
  SearchSortMode,
} from "../store/types.js";
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
  description:
    "Browse or search the knowledge vault. Modes: list, search, references, lint. Search supports search_mode (hybrid/keyword/semantic), match (fuzzy/all_terms/phrase/regex), folder, tags, and scope (wiki/archives/all).",
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
};

export const readTool: Tool = {
  name: "read",
  description:
    "Read a document from the knowledge vault by path or document id. Supports optional line range (line_start/line_end) and outline_only mode.",
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

const MAX_SEARCH_CHUNK_PREVIEW_CHARS = 1200;
const DEFAULT_LIST_LIMIT = 50;

export function formatSearchResultPath(dirPath: string, filename: string): string {
  const cleanDir = dirPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanFile = filename.trim().replace(/^\/+/, "");
  if (!cleanDir) return cleanFile;
  if (!cleanFile) return cleanDir;
  if (cleanDir === cleanFile || cleanDir.endsWith(`/${cleanFile}`)) return cleanDir;
  return `${cleanDir}/${cleanFile}`;
}

export async function resolveDocumentByIdOrPath(db: Store, requested: string): Promise<Document | null> {
  const trimmed = requested.trim();
  if (!trimmed) return null;
  let doc = await db.getDocument(trimmed);
  if (doc) return doc;
  if (typeof db.getDocumentByRelativePath === "function") {
    const normalized = trimmed.replace(/^\/+/, "");
    if (normalized) {
      doc = await db.getDocumentByRelativePath(normalized);
      if (doc) return doc;
      if (!normalized.startsWith("wiki/")) {
        doc = await db.getDocumentByRelativePath(`wiki/${normalized}`);
        if (doc) return doc;
      }
    }
  }
  return db.findDocumentByName(trimmed);
}

function normalizeListPathPrefix(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === "*" || trimmed === "/") return "";
  return trimmed.replace(/^\/+/, "");
}

function truncateSearchChunk(content: string, maxChars = MAX_SEARCH_CHUNK_PREVIEW_CHARS): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…(truncated, use read for full content)`;
}

export async function executeLocalSearch(
  workspace: string,
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  const mode = typeof args["mode"] === "string" && args["mode"] ? args["mode"] : "list";
  const hasExplicitLimit = typeof args["limit"] === "number" && Number.isFinite(args["limit"]) && args["limit"] > 0;
  const limit = hasExplicitLimit ? Math.floor(args["limit"] as number) : 10;
  const listLimit = hasExplicitLimit ? Math.floor(args["limit"] as number) : DEFAULT_LIST_LIMIT;
  const explicitFolder = typeof args["folder"] === "string" ? args["folder"].trim() : "";
  let folder = explicitFolder;
  let pathFilter = "";
  const rawPath = typeof args["path"] === "string" ? args["path"].trim() : "";
  if (rawPath === "wiki" || rawPath === "wiki/" || rawPath === "/wiki" || rawPath === "/wiki/") {
    pathFilter = "wiki";
  } else if (rawPath.startsWith("wiki/") || rawPath.startsWith("/wiki/")) {
    const cleanSub = rawPath.replace(/^\/+|\/+$/g, "");
    pathFilter = cleanSub;
    if (!folder) folder = cleanSub.replace(/^wiki\//, "");
  } else if (rawPath === "sources" || rawPath === "raw/sources") {
    pathFilter = "sources";
  }

  const strArray = (key: string): string[] =>
    Array.isArray(args[key])
      ? (args[key] as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "")
      : [];
  const rawArchived = typeof args["archived"] === "string" ? args["archived"].trim().toLowerCase() : "";
  const archived: ArchiveFilter =
    rawArchived === "include" || rawArchived === "only" || rawArchived === "exclude"
      ? rawArchived
      : "exclude";
  const matchRaw = typeof args["match"] === "string" ? args["match"].trim().toLowerCase() : "fuzzy";
  const matchMode: SearchMatchMode =
    matchRaw === "all_terms" || matchRaw === "phrase" || matchRaw === "regex" ? matchRaw : "fuzzy";
  const sortRaw = typeof args["sort"] === "string" ? args["sort"].trim().toLowerCase() : "relevance";
  const sortMode: SearchSortMode =
    sortRaw === "updated_desc" || sortRaw === "updated_asc" ? sortRaw : "relevance";
  const tagMode = args["tag_mode"] === "all" ? "all" : "any";
  const caseSensitive = args["case_sensitive"] === true;

  const searchOptions: SearchOptions = {
    page_types: strArray("types"),
    experience_kinds: strArray("kinds"),
    statuses: strArray("statuses"),
    confidences: strArray("confidences"),
    tags: strArray("tags"),
    tag_mode: tagMode,
    archived,
    ...(folder ? { folder } : {}),
    match: matchMode,
    case_sensitive: caseSensitive,
    sort: sortMode,
  };

  switch (mode) {
    case "list": {
      const allDocs = await db.listDocumentsFiltered({
        page_types: searchOptions.page_types,
        experience_kinds: searchOptions.experience_kinds,
        statuses: searchOptions.statuses,
        confidences: searchOptions.confidences,
        archived,
      });
      const prefix = normalizeListPathPrefix(rawPath);
      const filtered = prefix
        ? allDocs.filter((doc) => {
            const rel = doc.relative_path.replace(/^\/+/, "");
            return rel === prefix || rel.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
          })
        : allDocs;
      if (filtered.length === 0) return "No documents found.";
      const shown = filtered.slice(0, listLimit);
      let output =
        shown.length < filtered.length
          ? `Found ${filtered.length} documents (showing first ${shown.length}; narrow with path or increase limit):\n\n`
          : `Found ${filtered.length} documents:\n\n`;
      for (const doc of shown) {
        const meta = [doc.page_type, doc.experience_kind, doc.page_status, doc.confidence]
          .filter(Boolean)
          .join("/");
        const archivedTag = doc.archived_at ? ` [archived:${doc.archived_at}]` : "";
        output += `- **${doc.title || doc.filename}** — \`${doc.relative_path}\` (id: \`${doc.id}\`) [${meta || doc.file_type}]${archivedTag}\n`;
      }
      return output;
    }
    case "search": {
      const query = typeof args["query"] === "string" ? args["query"] : "";
      if (!query.trim()) return "Error: query is required for search mode";
      if (matchMode === "regex") {
        try {
          validateSearchRegex(query.trim());
        } catch (error) {
          return `Error: ${error instanceof SearchValidationError ? error.message : String(error)}`;
        }
      }
      const rawScope = typeof args["scope"] === "string" ? args["scope"].trim().toLowerCase() : "wiki";
      const scope = rawScope === "archives" || rawScope === "all" ? rawScope : "wiki";
      const rawSearchMode =
        typeof args["search_mode"] === "string" ? args["search_mode"].trim().toLowerCase() : "hybrid";
      const searchMode =
        rawSearchMode === "keyword" || rawSearchMode === "semantic" ? rawSearchMode : "hybrid";

      let results: SearchChunk[] = [];
      let effectiveMode = "keyword";
      let degradedReason: string | undefined;

      if (scope === "wiki" || scope === "all") {
        const canHybrid =
          searchMode !== "keyword" &&
          matchMode !== "phrase" &&
          matchMode !== "regex" &&
          typeof db.searchVector === "function" &&
          typeof db.getConfig === "function";
        if (canHybrid) {
          const detailed = await hybridSearchDetailed(
            { db, workspace } as ApiContext,
            query,
            limit,
            pathFilter,
            searchOptions,
            searchMode,
          );
          results = detailed.results;
          effectiveMode = detailed.effectiveMode;
          degradedReason = detailed.degradedReason;
        } else {
          results = await db.searchChunks(query, limit, pathFilter, searchOptions);
        }
      }

      let archiveHits: ArchiveSearchHit[] = [];
      if ((scope === "archives" || scope === "all") && typeof db.searchArchiveFiles === "function") {
        archiveHits = await db.searchArchiveFiles(query.trim(), {
          folder_path: folder || undefined,
          match: matchMode,
          case_sensitive: caseSensitive,
          limit,
        });
      }

      if (results.length === 0 && archiveHits.length === 0) {
        return `No results found for: ${query}`;
      }

      const modeNote = degradedReason ? ` [effective_mode: ${effectiveMode}; degraded: ${degradedReason}]` : "";
      let output = `Found ${results.length} wiki results${scope !== "wiki" ? ` and ${archiveHits.length} archive results` : ""} for "${query}"${modeNote}:\n\n`;
      for (const result of results) {
        const meta = [result.page_type, result.experience_kind, result.page_status, result.confidence]
          .filter(Boolean)
          .join("/");
        const fullPath = result.relative_path || formatSearchResultPath(result.path, result.filename);
        const idPart = result.document_id ? `, id: \`${result.document_id}\`` : "";
        output += `### ${result.title || result.filename} (\`${fullPath}\`${idPart}) [${meta ? `${meta} · ` : ""}score: ${result.score.toFixed(2)}]\n`;
        if (result.header_breadcrumb) output += `Section: ${result.header_breadcrumb}\n`;
        if (result.symptoms && result.symptoms.length > 0) {
          output += `Symptoms: ${result.symptoms.join(", ")}\n`;
        }
        if (result.matched_lines && result.matched_lines.length > 0) {
          output += `Matched lines:\n${result.matched_lines.map((ml) => `  L${ml.line}: ${ml.text}`).join("\n")}\n`;
        }
        output += `${truncateSearchChunk(result.content)}\n\n---\n\n`;
      }
      if (archiveHits.length > 0) {
        output += `## Archive Results (${archiveHits.length}):\n\n`;
        for (const hit of archiveHits) {
          output += `- [${hit.file.id}] \`${hit.file.relative_path}\` (${hit.match_type}, score: ${hit.score.toFixed(2)})\n`;
          if (hit.snippet) output += `  ${hit.snippet}\n`;
          if (hit.matched_lines && hit.matched_lines.length > 0) {
            output += `  Matched lines: ${hit.matched_lines.map((ml) => `L${ml.line}: ${ml.text}`).join(" | ")}\n`;
          }
        }
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

export interface ReadFormatOptions {
  lineStart?: number;
  lineEnd?: number;
  outlineOnly?: boolean;
}

export function extractMarkdownOutline(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const headings: string[] = [];
  let inFrontmatter = false;
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (i === 0 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") inFrontmatter = false;
      continue;
    }
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s+/.test(line)) {
      headings.push(`L${i + 1}: ${line.trim()}`);
    }
  }
  return headings;
}

export function formatDocumentRead(doc: Document, opts: ReadFormatOptions = {}): string {
  const lines = (doc.content ?? "").split(/\r?\n/);
  const totalLines = lines.length;
  let output = `# ${doc.title}\n`;
  output += `Document ID: ${doc.id}\n`;
  output += `Path: ${doc.relative_path}\n`;
  output += `Type: ${doc.file_type}  Status: ${doc.status}  Version: ${doc.version}\n`;
  if (doc.tags.length > 0) output += `Tags: ${doc.tags.join(", ")}\n`;

  if (opts.outlineOnly) {
    const headings = extractMarkdownOutline(doc.content ?? "");
    output += `Lines: ${totalLines} (outline_only)\n\n---\n\n`;
    output += headings.length > 0 ? headings.join("\n") : "(no markdown headings)";
    return output;
  }

  if (opts.lineStart !== undefined || opts.lineEnd !== undefined) {
    const start = Math.max(1, Math.floor(opts.lineStart ?? 1));
    const end = Math.min(totalLines, Math.floor(opts.lineEnd ?? totalLines));
    const slice = start <= end ? lines.slice(start - 1, end).join("\n") : "";
    output += `Lines: ${start}-${Math.max(start - 1, end)} / ${totalLines}\n\n---\n\n${slice}`;
    return output;
  }

  output += `\n---\n\n${doc.content}`;
  return output;
}

export function parseReadFormatOptions(args: Record<string, unknown>): ReadFormatOptions {
  const lineStart =
    typeof args["line_start"] === "number" && Number.isFinite(args["line_start"])
      ? args["line_start"]
      : undefined;
  const lineEnd =
    typeof args["line_end"] === "number" && Number.isFinite(args["line_end"])
      ? args["line_end"]
      : undefined;
  const outlineOnly = args["outline_only"] === true;
  return { lineStart, lineEnd, outlineOnly };
}

export async function executeLocalRead(db: Store, args: Record<string, unknown>): Promise<string> {
  const requested = typeof args["path"] === "string" ? args["path"] : "";
  if (!requested.trim()) return "Error: path is required";
  const doc = await resolveDocumentByIdOrPath(db, requested);
  if (!doc) return `Document not found: ${requested}`;
  return formatDocumentRead(doc, parseReadFormatOptions(args));
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
