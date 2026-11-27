import path from "node:path";
import { parseFrontmatter, titleFromFilename } from "./frontmatter.js";

export const INDEX_REL_PATH = "wiki/index.md";

interface WikiSubdir {
  dir: string;
  heading: string;
}

const WIKI_SUBDIRS: WikiSubdir[] = [];

export interface IndexEntry {
  subdir: string;
  slug: string;
  title: string;
  type: string;
  description: string;
  date: string;
  confidence: string;
  status: string;
  last_verified: string;
  review_after: string;
  archived_at: string;
  archive_reason: string;
  superseded_by: string;
}

const SYSTEM_WIKI_PATHS = new Set(["wiki/overview.md"]);

export interface IndexSourceDocument {
  relative_path?: string;
  title?: string;
  date?: string;
  updated_at?: string;
  content?: string;
  source_kind?: string;
  page_type?: string;
  confidence?: string;
  page_status?: string;
  last_verified?: string;
  review_after?: string;
  archived_at?: string;
  archive_reason?: string;
  superseded_by?: string;
}

/**
 * Build index entries from DB documents for on-demand export (`llmwiki export --with-index`).
 */
export function indexEntriesFromDocuments(
  docs: readonly IndexSourceDocument[],
): Map<string, IndexEntry[]> {
  const result = new Map<string, IndexEntry[]>();
  for (const doc of docs) {
    const rel = doc.relative_path ?? "";
    if (!rel.startsWith("wiki/")) continue;
    if (doc.source_kind && doc.source_kind !== "wiki") continue;
    if (SYSTEM_WIKI_PATHS.has(rel)) continue;
    if (rel.startsWith("wiki/templates/")) continue;

    const base = rel.slice("wiki/".length);
    const slash = base.lastIndexOf("/");
    const subdir = slash >= 0 ? base.slice(0, slash) : "";
    const filename = slash >= 0 ? base.slice(slash + 1) : base;
    const ext = path.posix.extname(filename);
    const slug = ext ? filename.slice(0, -ext.length) : filename;
    const frontmatter = parseFrontmatter(doc.content ?? "");
    const title = doc.title || frontmatter.title || titleFromFilename(filename);
    const description = truncateRunes(frontmatter.description ?? "", 80);
    let date = doc.date || frontmatter.date;
    if (!date) date = doc.updated_at ? doc.updated_at.slice(0, 10) : formatDate(new Date());
    else if (date.length > 10) date = date.slice(0, 10);

    const list = result.get(subdir) ?? [];
    list.push({
      subdir,
      slug,
      title,
      type: doc.page_type || frontmatter.type || "",
      description,
      date,
      confidence: doc.confidence || frontmatter.confidence || "",
      status: doc.page_status || frontmatter.status || "",
      last_verified: doc.last_verified || frontmatter.last_verified || "",
      review_after: doc.review_after || frontmatter.review_after || "",
      archived_at: doc.archived_at || frontmatter.archived_at || "",
      archive_reason: doc.archive_reason || frontmatter.archive_reason || "",
      superseded_by: doc.superseded_by || frontmatter.superseded_by || "",
    });
    result.set(subdir, list);
  }
  for (const entries of result.values()) {
    entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  }
  return result;
}

export class IndexBuilder {
  constructor(private readonly _workspace = "") {}

  buildIndexContent(date: string, entriesBySubdir: Map<string, IndexEntry[]> | null): string {
    let output = "---\n";
    output += "title: 内容目录\n";
    output += "type: index\n";
    output += `date: ${date}\n`;
    output += "---\n\n";
    output += "# 内容目录\n\n";
    output += "> 本文件由 `llmwiki export --with-index` 生成，仅作离线导出目录。\n\n";

    const headings = new Map(WIKI_SUBDIRS.map((item) => [item.dir, item.heading]));
    const dirKeys = entriesBySubdir ? [...entriesBySubdir.keys()] : [];
    const orderedDirs: string[] = [];
    for (const subdir of WIKI_SUBDIRS) {
      if (entriesBySubdir?.has(subdir.dir)) orderedDirs.push(subdir.dir);
    }
    for (const dir of dirKeys.sort()) {
      if (!orderedDirs.includes(dir)) orderedDirs.push(dir);
    }

    const archived: IndexEntry[] = [];
    for (const dir of orderedDirs) {
      const heading = headings.get(dir) ?? dir;
      const entries = (entriesBySubdir?.get(dir) ?? []).filter((entry) => {
        if (entry.archived_at) {
          archived.push(entry);
          return false;
        }
        return true;
      });
      output += `## ${heading}\n\n`;
      output += "| 页面 | 标题 | 摘要 | 更新日期 | 置信度 | 状态 | 核实日期 | 复审日期 |\n";
      output += "|------|------|------|----------|--------|------|----------|----------|\n";
      for (const entry of entries) {
        const link = `[[${entry.subdir}/${entry.slug}\\|${escapeGFMTableCell(entry.title)}]]`;
        output += `| ${link} | ${escapeGFMTableCell(entry.title)} | ${escapeGFMTableCell(entry.description)} | ${escapeGFMTableCell(entry.date)} | ${escapeGFMTableCell(entry.confidence || "-")} | ${escapeGFMTableCell(entry.status || "-")} | ${escapeGFMTableCell(entry.last_verified || "-")} | ${escapeGFMTableCell(entry.review_after || "-")} |\n`;
      }
      output += "\n";
    }

    if (archived.length > 0) {
      output += "## 已归档 (archived)\n\n";
      output += "| 页面 | 类型 | 标题 | 摘要 | 归档日期 | 归档原因 | 替代页 |\n";
      output += "|------|------|------|------|----------|----------|--------|\n";
      for (const entry of archived) {
        const link = `[[${entry.subdir}/${entry.slug}\\|${escapeGFMTableCell(entry.title)}]]`;
        output += `| ${link} | ${escapeGFMTableCell(entry.type || "-")} | ${escapeGFMTableCell(entry.title)} | ${escapeGFMTableCell(entry.description)} | ${escapeGFMTableCell(entry.archived_at)} | ${escapeGFMTableCell(entry.archive_reason || "-")} | ${escapeGFMTableCell(entry.superseded_by || "-")} |\n`;
      }
      output += "\n";
    }
    return output;
  }
}

export function escapeGFMTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function truncateRunes(value: string, max: number): string {
  if (max <= 0 || !value) return value;
  const runes = [...value];
  if (runes.length <= max) return value;
  return runes.slice(0, max).join("") + "…";
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
