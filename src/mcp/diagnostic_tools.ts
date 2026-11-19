import { stat } from "node:fs/promises";
import path from "node:path";
import {
  LINT_CODE_DEAD_LINK,
  LINT_CODE_DUPLICATE_PAGE,
  LINT_CODE_ENTITY_CONCEPT_COUPLING,
  LINT_CODE_GHOST_INDEX_ENTRY,
  LINT_CODE_MISPLACED_WIKI_PAGE,
  LINT_CODE_MISSING_FRONTMATTER,
  LINT_CODE_ORPHAN_PAGE,
  LINT_CODE_TYPE_DIR_MISMATCH,
  LINT_SEVERITY_ERROR,
  LINT_SEVERITY_WARNING,
  type LintReport,
} from "../engine/lint_types.js";
import { lintGhostIndexEntries, lintWorkspace } from "../engine/lint.js";
import { classifyWikiPath, isWikiSystemPath, TYPED_WIKI_SUBDIRS } from "../engine/wiki_org.js";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { createEngineStoreAdapter } from "./store_adapter.js";
import type { Tool } from "./types.js";

export const auditTool: Tool = {
  name: "audit",
  description:
    "Run a comprehensive health check on the wiki. Returns issues (dead links, orphan pages, missing metadata) and statistics (page count, tag distribution, content length).",
  inputSchema: {
    type: "object",
    properties: {
      focus: {
        type: "string",
        enum: ["all", "structure", "content", "metadata", "links"],
        default: "all",
        description: "Focus area for the audit",
      },
    },
    required: [],
  },
};

export const structureTool: Tool = {
  name: "structure",
  description:
    "Show the wiki directory tree with page counts, tag distribution, and empty directory markers.",
  inputSchema: { type: "object", properties: {}, required: [] },
};

export const gapsTool: Tool = {
  name: "gaps",
  description:
    "Find knowledge coverage gaps. Modes: dangling (pages referenced but missing), uncited (source files not referenced by any wiki page).",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["dangling", "uncited", "all"], default: "all" },
    },
    required: [],
  },
};

export const similarTool: Tool = {
  name: "similar",
  description:
    "Find wiki pages with similar content that may be candidates for merging. Uses full-text search overlap to identify candidate pairs.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Find pages similar to this specific page (omit for global scan)" },
      scan: { type: "boolean", default: false },
      limit: { type: "integer", default: 50 },
    },
    required: [],
  },
};

export async function executeLocalAudit(
  workspace: string,
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  const focus = typeof args["focus"] === "string" && args["focus"] ? args["focus"] : "all";
  let output = "# Wiki 诊断报告\n\n";

  const docs = await db.listDocuments();
  const wikiDocs = filterBySourceKind(docs, "wiki");
  const sourceDocs = filterBySourceKind(docs, "source");

  output += "## 概览\n\n";
  output += `- Wiki 页面: ${wikiDocs.length}\n`;
  output += `- 源文件: ${sourceDocs.length}\n`;

  const tagCount = new Map<string, number>();
  for (const doc of wikiDocs) {
    for (const tag of doc.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  }
  if (tagCount.size > 0) {
    output += "\n### 标签分布\n\n";
    for (const tag of sortedKeys(tagCount)) {
      output += `- ${tag} (${tagCount.get(tag)})\n`;
    }
  }

  if (focus === "all" || focus === "content") {
    const shortPages = wikiDocs.filter((doc) => [...doc.content].length < 200).length;
    if (shortPages > 0) {
      output += `\n### 内容问题\n\n- **内容过短** (< 200 字): ${shortPages} 页\n`;
    }
  }

  if (workspace && db) {
    try {
      const ghostIssues = await lintGhostIndexEntries(workspace, createEngineStoreAdapter(db));
      if (ghostIssues.length > 0) {
        output += `\n## 索引幽灵页 (${ghostIssues.length})\n\n`;
        for (const issue of ghostIssues) {
          output += `- **${issue.severity}** \`${issue.path}\` — ${issue.message}\n`;
        }
      }
    } catch {
      // Diagnostics are best-effort; an unreadable workspace skips this section.
    }
  }

  if (focus === "all" || focus === "structure" || focus === "links" || focus === "metadata") {
    if (workspace) {
      try {
        const report = await lintWorkspace(workspace);
        if (report.issues.length > 0) {
          output += formatAuditLintSection(report, focus);
        }
      } catch {
        // Diagnostics are best-effort.
      }
    }
  }

  if (focus === "all" || focus === "structure") {
    const uncited = await findUncitedSources(db, sourceDocs);
    if (uncited.length > 0) {
      output += `\n## 未被引用的源文件 (${uncited.length})\n\n`;
      for (const doc of uncited) {
        output += `- ${doc.title || doc.filename} — \`${doc.relative_path}\`\n`;
      }
    }
  }

  return output;
}

function formatAuditLintSection(report: LintReport, focus: string): string {
  let errors = 0;
  let warnings = 0;
  for (const issue of report.issues) {
    if (issue.severity === LINT_SEVERITY_ERROR) errors += 1;
    else if (issue.severity === LINT_SEVERITY_WARNING) warnings += 1;
  }
  let output = `\n## Lint 检查 (${errors} 错误, ${warnings} 警告)\n\n`;
  for (const issue of report.issues) {
    if (focus !== "all" && !matchesFocus(issue.code, focus)) continue;
    output += `- **${issue.severity}** \`${issue.path}\` — ${issue.message}\n`;
  }
  return output;
}

function matchesFocus(code: string, focus: string): boolean {
  switch (focus) {
    case "structure":
      return [
        LINT_CODE_ORPHAN_PAGE,
        LINT_CODE_TYPE_DIR_MISMATCH,
        LINT_CODE_MISPLACED_WIKI_PAGE,
        LINT_CODE_ENTITY_CONCEPT_COUPLING,
        LINT_CODE_DUPLICATE_PAGE,
        LINT_CODE_GHOST_INDEX_ENTRY,
      ].includes(code);
    case "links":
      return code === LINT_CODE_DEAD_LINK;
    case "metadata":
      return code === LINT_CODE_MISSING_FRONTMATTER;
    default:
      return true;
  }
}

export async function executeLocalStructure(
  workspace: string,
  db: Store,
): Promise<string> {
  if (!workspace) return "Error: workspace not configured";
  const docs = await db.listDocuments();
  const wikiDocs = filterBySourceKind(docs, "wiki");
  const contentCount = wikiDocs.filter((doc) => !isWikiSystemPath(doc.relative_path)).length;

  const dirPages = new Map<string, Document[]>();
  for (const doc of wikiDocs) {
    let dir = path.posix.dirname(doc.relative_path);
    dir = dir.replace(/^wiki\//, "");
    if (dir === "wiki" || dir === ".") dir = "";
    const pages = dirPages.get(dir) ?? [];
    pages.push(doc);
    dirPages.set(dir, pages);
  }

  let output = "# Wiki 目录结构\n\n";
  output += `工作区：\`${workspace}\`\n`;
  output +=
    "数据来源：SQLite index（与文件系统不一致时请运行 `llmwiki reindex`，将自动清理幽灵索引）\n\n";
  output += `总计 ${wikiDocs.length} 个 wiki 文档（${contentCount} 个业务内容页）\n\n`;

  const reserved: Document[] = [];
  const misplaced: Document[] = [];
  for (const doc of dirPages.get("") ?? []) {
    const kind = classifyWikiPath(doc.relative_path);
    if (kind === "misplaced") misplaced.push(doc);
    else reserved.push(doc);
  }

  if (reserved.length > 0) {
    output += "## 顶层系统页面\n\n";
    for (const doc of reserved) output += `- ${doc.title || doc.filename} (\`${doc.relative_path}\`)\n`;
    output += "\n";
  }
  if (misplaced.length > 0) {
    output += `## 待整理页面 (${misplaced.length})\n\n`;
    for (const doc of misplaced) {
      output += `- ${doc.title || doc.filename} — \`${doc.relative_path}\`（应移入 typed 子目录）\n`;
    }
    output += "\n";
  }

  const shownDirs = new Set<string>();
  for (const dir of TYPED_WIKI_SUBDIRS) {
    const pages = dirPages.get(dir) ?? [];
    shownDirs.add(dir);
    output += `├── ${dir}/ (${pages.length} 页)\n`;
    pages.forEach((doc, index) => {
      const prefix = index === pages.length - 1 ? "│   └── " : "│   ├── ";
      const tags = doc.tags.length > 0 ? ` [${doc.tags.join(", ")}]` : "";
      output += `${prefix}${doc.title || doc.filename}${tags}\n`;
    });
    if (pages.length === 0) output += "│   (空目录)\n";
  }

  const templates = dirPages.get("templates") ?? [];
  if (templates.length > 0) {
    shownDirs.add("templates");
    output += `├── templates/ (${templates.length} 个系统模板)\n`;
    templates.forEach((doc, index) => {
      const prefix = index === templates.length - 1 ? "│   └── " : "│   ├── ";
      output += `${prefix}${doc.title || doc.filename} (系统模板)\n`;
    });
  } else if (await templatesDirExists(workspace)) {
    output += "├── templates/ (0 个系统模板)\n│   (空目录)\n";
  }

  for (const [dir, pages] of dirPages) {
    if (shownDirs.has(dir) || dir === "") continue;
    output += `├── ${dir}/ (${pages.length} 页)\n`;
    for (const doc of pages) output += `│   ├── ${doc.title || doc.filename}\n`;
  }

  const tagCount = new Map<string, number>();
  for (const doc of wikiDocs) {
    for (const tag of doc.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  }
  if (tagCount.size > 0) {
    output += "\n## 标签分布\n\n";
    for (const tag of sortedKeys(tagCount)) output += `- ${tag} (${tagCount.get(tag)})\n`;
  }

  const noTags = wikiDocs.filter((doc) => doc.tags.length === 0).length;
  if (noTags > 0) output += `\n${noTags} 个页面没有标签\n`;
  return output;
}

export async function executeLocalGaps(
  workspace: string,
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  const mode = typeof args["mode"] === "string" && args["mode"] ? args["mode"] : "all";
  let output = "";
  if (mode === "all" || mode === "dangling") {
    const dangling = await findDanglingLinks(workspace);
    output += `## 缺失页面 (被引用但不存在) (${dangling.length})\n\n`;
    if (dangling.length > 0) {
      for (const item of dangling) {
        output += `- [[${item.target}]] — 被 ${item.refCount} 个页面引用\n`;
      }
    } else {
      output += "无缺失页面\n";
    }
  }
  if (mode === "all" || mode === "uncited") {
    const docs = await db.listDocuments();
    const sourceDocs = filterBySourceKind(docs, "source");
    const uncited = await findUncitedSources(db, sourceDocs);
    output += `\n## 未被引用的源文件 (${uncited.length})\n\n`;
    if (uncited.length > 0) {
      for (const doc of uncited) output += `- ${doc.title || doc.filename} — \`${doc.relative_path}\`\n`;
    } else {
      output += "所有源文件都被 wiki 页面引用\n";
    }
  }
  return output;
}

interface DanglingLink {
  target: string;
  refCount: number;
}

async function findDanglingLinks(workspace: string): Promise<DanglingLink[]> {
  if (!workspace) return [];
  let report: LintReport;
  try {
    report = await lintWorkspace(workspace);
  } catch {
    return [];
  }
  const counts = new Map<string, number>();
  for (const issue of report.issues) {
    if (issue.code !== LINT_CODE_DEAD_LINK) continue;
    const target = extractQuotedTarget(issue.message);
    if (target) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([target, refCount]) => ({ target, refCount }))
    .sort((a, b) => b.refCount - a.refCount);
}

function extractQuotedTarget(message: string): string {
  const start = message.indexOf('"');
  if (start < 0) return "";
  const end = message.indexOf('"', start + 1);
  if (end < 0) return "";
  return message.slice(start + 1, end);
}

async function findUncitedSources(db: Store, sourceDocs: Document[]): Promise<Document[]> {
  const uncited: Document[] = [];
  for (const doc of sourceDocs) {
    try {
      const backlinks = await db.getBacklinks(doc.id);
      if (backlinks.length === 0) uncited.push(doc);
    } catch {
      // Skip documents whose backlinks cannot be read.
    }
  }
  return uncited;
}

interface SimilarPair {
  pathA: string;
  titleA: string;
  pathB: string;
  titleB: string;
  score: number;
}

export async function executeLocalSimilar(
  db: Store,
  args: Record<string, unknown>,
): Promise<string> {
  const specificPath = typeof args["path"] === "string" ? args["path"] : "";
  const limit = typeof args["limit"] === "number" ? args["limit"] : 50;

  const docs = await db.listDocuments();
  let wikiDocs = filterBySourceKind(docs, "wiki");
  if (wikiDocs.length > limit) wikiDocs = wikiDocs.slice(0, limit);

  let candidates = wikiDocs;
  if (specificPath) {
    candidates = wikiDocs.filter(
      (doc) => doc.relative_path === specificPath || doc.filename === specificPath,
    );
    if (candidates.length === 0) return `Page not found: ${specificPath}`;
  }

  const pairs: SimilarPair[] = [];
  const seen = new Set<string>();
  for (const doc of candidates) {
    let query = doc.content;
    if ([...query].length > 500) query = [...query].slice(0, 500).join("");
    if (!query.trim()) continue;
    let results;
    try {
      results = await db.searchChunks(query, 5, "wiki");
    } catch {
      continue;
    }
    for (const result of results) {
      if (result.path === doc.relative_path) continue;
      if (result.score < 0.3) continue;
      let a = doc.relative_path;
      let b = result.path;
      if (a > b) [a, b] = [b, a];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        pathA: a,
        titleA: pathToTitle(a, wikiDocs),
        pathB: b,
        titleB: pathToTitle(b, wikiDocs),
        score: result.score,
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  if (pairs.length === 0) return "未发现明显的内容相似页面。\n";
  let output = `# 发现 ${pairs.length} 对可能相似的页面\n\n`;
  pairs.forEach((pair, index) => {
    output += `${index + 1}. **${pair.titleA}** (\`${pair.pathA}\`) ⟷ **${pair.titleB}** (\`${pair.pathB}\`)\n`;
    output += `   FTS 重叠度: ${pair.score.toFixed(2)} — 建议检查是否需要合并或补充交叉链接\n\n`;
  });
  return output;
}

export function filterBySourceKind(docs: Document[], kind: string): Document[] {
  return docs.filter((doc) => doc.source_kind === kind);
}

function sortedKeys(map: Map<string, number>): string[] {
  return [...map.keys()].sort();
}

function pathToTitle(relativePath: string, docs: Document[]): string {
  for (const doc of docs) {
    if (doc.relative_path === relativePath) return doc.title || doc.filename;
  }
  return path.posix.basename(relativePath);
}

async function templatesDirExists(workspace: string): Promise<boolean> {
  try {
    const info = await stat(path.join(workspace, "wiki", "templates"));
    return info.isDirectory();
  } catch {
    return false;
  }
}
