import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { chunkText, defaultChunkConfig } from "./chunker.js";
import { parseFrontmatter } from "./frontmatter.js";
import { FOLDER_OVERVIEW_FILENAME, folderPathFromWikiRelPath, isFolderOverviewPath, isWikiSystemPath } from "./wiki_org.js";
import type { Store } from "../store/interfaces.js";
import type { Document, PageWrite, WikiFolderWithCounts } from "../store/types.js";

const AUTO_START = "<!-- AUTO_OVERVIEW_START -->";
const AUTO_END = "<!-- AUTO_OVERVIEW_END -->";

const TYPE_GROUP_ORDER: Array<{ type: string; label: string }> = [
  { type: "experience", label: "经验与排查 (experience)" },
  { type: "concept", label: "核心概念 (concept)" },
  { type: "entity", label: "实体与对象 (entity)" },
  { type: "synthesis", label: "综合分析 (synthesis)" },
  { type: "comparison", label: "对比分析 (comparison)" },
  { type: "ledger", label: "台账 (ledger)" },
  { type: "query", label: "查询归档 (query)" },
];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function docSummary(doc: Document): string {
  const fm = parseFrontmatter(doc.content ?? "");
  return (fm.description || "").trim().replace(/\s+/g, " ");
}

function buildAutoBlock(
  childFolders: WikiFolderWithCounts[],
  directDocs: Document[],
): string {
  const lines: string[] = [AUTO_START];
  if (childFolders.length > 0) {
    lines.push("### 子主题组", "");
    for (const child of [...childFolders].sort((a, b) => a.sort_order - b.sort_order || a.path.localeCompare(b.path))) {
      const label = child.display_name || path.posix.basename(child.path);
      const desc = child.description ? ` — ${child.description}` : "";
      lines.push(`- **[[wiki/${child.path}/${FOLDER_OVERVIEW_FILENAME}|${label}]]** (${child.total_count} 页)${desc}`);
    }
    lines.push("");
  }

  const byType = new Map<string, Document[]>();
  for (const doc of directDocs) {
    if (isFolderOverviewPath(doc.relative_path)) continue;
    const t = (doc.page_type || "page").toLowerCase();
    const list = byType.get(t) ?? [];
    list.push(doc);
    byType.set(t, list);
  }

  const orderedTypes = [
    ...TYPE_GROUP_ORDER,
    ...[...byType.keys()]
      .filter((t) => !TYPE_GROUP_ORDER.some((g) => g.type === t))
      .sort()
      .map((t) => ({ type: t, label: t })),
  ];

  for (const group of orderedTypes) {
    const docs = byType.get(group.type);
    if (!docs || docs.length === 0) continue;
    lines.push(`### ${group.label}`, "");
    for (const doc of [...docs].sort((a, b) => (a.title || a.filename).localeCompare(b.title || b.filename, "zh-Hans-CN"))) {
      const title = doc.title || doc.filename;
      const summary = docSummary(doc);
      lines.push(`- [[${doc.relative_path}|${title}]]${summary ? ` — ${summary}` : ""}`);
    }
    lines.push("");
  }

  if (childFolders.length === 0 && directDocs.length === 0) {
    lines.push("（当前目录暂无页面）", "");
  }

  lines.push(AUTO_END);
  return lines.join("\n");
}

function mergeAutoBlock(existingContent: string, header: string, autoBlock: string): string {
  const startIdx = existingContent.indexOf(AUTO_START);
  const endIdx = existingContent.indexOf(AUTO_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = existingContent.slice(0, startIdx).trimEnd();
    const after = existingContent.slice(endIdx + AUTO_END.length).trimStart();
    return after ? `${before}\n\n${autoBlock}\n\n${after}\n` : `${before}\n\n${autoBlock}\n`;
  }
  const trimmed = existingContent.trim();
  if (trimmed) {
    return `${trimmed}\n\n${autoBlock}\n`;
  }
  return `${header.trimEnd()}\n\n${autoBlock}\n`;
}

export function renderFolderOverview(
  folder: WikiFolderWithCounts,
  childFolders: WikiFolderWithCounts[],
  directDocs: Document[],
  existingContent = "",
): string {
  const title = folder.display_name || path.posix.basename(folder.path);
  const today = new Date().toISOString().slice(0, 10);
  const header = [
    "---",
    `title: ${title}（目录概览）`,
    "type: page",
    `date: ${today}`,
    `description: ${folder.description || `${title} 主题目录概览`}`,
    "---",
    "",
    `# ${title}`,
    "",
    folder.description ? `> ${folder.description}` : "> 本页为目录自动聚合概览节点。",
  ].join("\n");
  const autoBlock = buildAutoBlock(childFolders, directDocs);
  return mergeAutoBlock(existingContent, header, autoBlock);
}

export function renderRootOverview(
  folders: WikiFolderWithCounts[],
  docs: Document[],
  existingContent = "",
): string {
  const today = new Date().toISOString().slice(0, 10);
  const header = [
    "---",
    "title: 全局总览",
    "type: page",
    `date: ${today}`,
    "description: 知识库主题域地图（自动维护）",
    "---",
    "",
    "# 全局总览",
    "",
    "先按读者问题选择主题域，再进入主题组；page_type 只表示页面职责，不代表目录。",
  ].join("\n");

  const topFolders = folders
    .filter((f) => !f.path.includes("/") && !["concepts", "entities", "devices", "sources", "templates"].includes(f.path.toLowerCase()))
    .sort((a, b) => a.sort_order - b.sort_order || a.path.localeCompare(b.path));

  const lines: string[] = [AUTO_START, "## 主题域地图", ""];
  for (const domain of topFolders) {
    const label = domain.display_name || domain.path;
    const desc = domain.description ? ` — ${domain.description}` : "";
    lines.push(`- **[[wiki/${domain.path}/${FOLDER_OVERVIEW_FILENAME}|${label}]]** (${domain.total_count} 页)${desc}`);
    const children = folders
      .filter((f) => f.path.startsWith(`${domain.path}/`) && f.path.split("/").length === 2)
      .sort((a, b) => a.sort_order - b.sort_order || a.path.localeCompare(b.path));
    for (const child of children) {
      const cLabel = child.display_name || path.posix.basename(child.path);
      lines.push(`  - [[wiki/${child.path}/${FOLDER_OVERVIEW_FILENAME}|${cLabel}]] (${child.total_count} 页)`);
    }
  }
  if (topFolders.length === 0) {
    const bizCount = docs.filter((d) => d.source_kind === "wiki" && !isWikiSystemPath(d.relative_path) && !isFolderOverviewPath(d.relative_path)).length;
    lines.push(`（当前共 ${bizCount} 篇业务页，尚无主题域目录）`);
  }
  lines.push("", AUTO_END);
  return mergeAutoBlock(existingContent, header, lines.join("\n"));
}

export async function refreshFolderOverviews(
  db: Store,
  affectedFolders: string[],
  refreshRoot = true,
): Promise<string[]> {
  const [folders, docs] = await Promise.all([
    typeof db.listFolders === "function" ? db.listFolders(true) : Promise.resolve([]),
    typeof db.listDocumentsWithContent === "function"
      ? db.listDocumentsWithContent()
      : db.listDocumentsFiltered({ source_kind: "wiki", exclude_hidden: true }),
  ]);

  const folderMap = new Map(folders.map((f) => [f.path, f]));
  const targets = new Set<string>();
  for (const raw of affectedFolders) {
    const clean = raw.trim().replace(/^\/+|\/+$/g, "").replace(/^wiki\//, "");
    if (!clean) continue;
    const parts = clean.split("/");
    for (let i = 1; i <= parts.length; i += 1) {
      const anc = parts.slice(0, i).join("/");
      if (folderMap.has(anc)) targets.add(anc);
    }
  }

  const writes: PageWrite[] = [];
  const writtenPaths: string[] = [];

  for (const folderPath of [...targets].sort()) {
    const folder = folderMap.get(folderPath);
    if (!folder) continue;
    const childFolders = folders.filter(
      (f) => f.path.startsWith(`${folderPath}/`) && !f.path.slice(folderPath.length + 1).includes("/"),
    );
    const directDocs = docs.filter(
      (d) => d.source_kind === "wiki" && !d.archived_at && folderPathFromWikiRelPath(d.relative_path) === folderPath && !isFolderOverviewPath(d.relative_path),
    );
    const relPath = `wiki/${folderPath}/${FOLDER_OVERVIEW_FILENAME}`;
    const existing = await db.getDocumentByRelativePath(relPath);
    const content = renderFolderOverview(folder, childFolders, directDocs, existing?.content ?? "");
    if (existing && existing.content === content) continue;

    const doc = buildOverviewDocument(existing, relPath, `${folder.display_name || folderPath}（目录概览）`, content);
    writes.push({
      relative_path: relPath,
      document: doc,
      operation: existing ? "update" : "create",
      chunks: chunkText(content, 1, defaultChunkConfig()).map((c) => ({
        id: "",
        document_id: doc.id,
        chunk_index: c.index,
        content: c.content,
        page: c.page,
        start_char: c.startChar,
        token_count: c.tokenCount,
        header_breadcrumb: c.headerBreadcrumb,
      })),
      refs: [],
    });
    writtenPaths.push(relPath);
  }

  if (refreshRoot) {
    const rootRel = "wiki/overview.md";
    const existingRoot = await db.getDocumentByRelativePath(rootRel);
    const rootContent = renderRootOverview(folders, docs, existingRoot?.content ?? "");
    if (!existingRoot || existingRoot.content !== rootContent) {
      const doc = buildOverviewDocument(existingRoot, rootRel, "全局总览", rootContent);
      writes.push({
        relative_path: rootRel,
        document: doc,
        operation: existingRoot ? "update" : "create",
        chunks: chunkText(rootContent, 1, defaultChunkConfig()).map((c) => ({
          id: "",
          document_id: doc.id,
          chunk_index: c.index,
          content: c.content,
          page: c.page,
          start_char: c.startChar,
          token_count: c.tokenCount,
          header_breadcrumb: c.headerBreadcrumb,
        })),
        refs: [],
      });
      writtenPaths.push(rootRel);
    }
  }

  if (writes.length > 0 && typeof db.applyChangeSet === "function") {
    await db.applyChangeSet(
      {
        id: randomUUID(),
        kind: "manual",
        summary: `refresh ${writes.length} overview node(s)`,
        page_count: writes.length,
        created_at: "",
      },
      writes,
    );
  }

  return writtenPaths;
}

function buildOverviewDocument(
  existing: Document | null,
  relPath: string,
  title: string,
  content: string,
): Document {
  const dir = `/${path.posix.dirname(relPath)}/`;
  const filename = path.posix.basename(relPath);
  const hash = sha256(content);
  const today = new Date().toISOString().slice(0, 10);
  if (existing) {
    return {
      ...existing,
      title,
      content,
      content_hash: hash,
      file_size: Buffer.byteLength(content, "utf8"),
      page_type: "page",
      date: today,
    };
  }
  return {
    id: randomUUID(),
    user_id: "default",
    filename,
    title,
    path: dir,
    relative_path: relPath,
    source_kind: "wiki",
    file_type: "md",
    file_size: Buffer.byteLength(content, "utf8"),
    document_number: 0,
    status: "ready",
    page_count: 0,
    content,
    tags: [],
    date: today,
    metadata: "{}",
    error_message: "",
    version: 0,
    parser: "",
    content_hash: hash,
    stale_since: "",
    highlights: "[]",
    created_at: "",
    updated_at: "",
    page_type: "page",
  };
}
