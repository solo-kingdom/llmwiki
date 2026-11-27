import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
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

const SYSTEM_WIKI_PATHS = new Set(["wiki/index.md", "wiki/log.md", "wiki/overview.md"]);

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
 * Build index entries from DB documents. PostgreSQL is the SSOT; the workspace
 * directory may only hold a stale export, so reindex must not depend on files.
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
  constructor(private readonly workspace: string) {}

  async buildIndex(): Promise<string> {
    const entries = await this.scanWikiPages();
    return this.buildIndexContent(formatDate(new Date()), entries);
  }

  buildIndexContent(date: string, entriesBySubdir: Map<string, IndexEntry[]> | null): string {
    let output = "---\n";
    output += "title: 内容目录\n";
    output += "type: index\n";
    output += `date: ${date}\n`;
    output += "---\n\n";
    output += "# 内容目录\n\n";
    output += "> 本文件由 `llmwiki reindex` 自动维护，请勿手动编辑。\n\n";

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

  private async scanWikiPages(): Promise<Map<string, IndexEntry[]>> {
    const result = new Map<string, IndexEntry[]>();
    const wikiRoot = path.join(this.workspace, "wiki");
    await this.walkDir(wikiRoot, "", result);
    for (const entries of result.values()) {
      entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    }
    return result;
  }

  private async walkDir(
    dirPath: string,
    relSubdir: string,
    result: Map<string, IndexEntry[]>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (relSubdir === "" && name === "templates") continue;
        if (name.startsWith(".")) continue;
        const nextSubdir = relSubdir ? `${relSubdir}/${name}` : name;
        await this.walkDir(path.join(dirPath, name), nextSubdir, result);
        continue;
      }
      if (!relSubdir) continue;
      if (!name.toLowerCase().endsWith(".md")) continue;
      if (name === "index.md" || name === "log.md" || name === "overview.md") continue;
      const list = result.get(relSubdir) ?? [];
      list.push(await this.entryFromFile(relSubdir, name, path.join(dirPath, name)));
      result.set(relSubdir, list);
    }
  }

  private async entryFromFile(subdir: string, filename: string, fullPath: string): Promise<IndexEntry> {
    const ext = path.posix.extname(filename);
    const slug = ext ? filename.slice(0, -ext.length) : filename;
    const data = await readFile(fullPath, "utf8");
    const frontmatter = parseFrontmatter(data);
    const title = frontmatter.title || titleFromFilename(filename);
    let summary = frontmatter.description;
    const expKind = frontmatter.kind ?? "";
    if (frontmatter.type === "experience" && (expKind === "pitfall" || expKind === "pattern")) {
      const parts = [`[${expKind}]`];
      if (summary) parts.push(summary);
      if (frontmatter.symptoms && frontmatter.symptoms.length > 0) {
        parts.push(`现象：${frontmatter.symptoms.join("、")}`);
      }
      summary = parts.join(" ");
    }
    const description = truncateRunes(summary, 80);
    let date = frontmatter.date;
    if (!date) {
      const info = await stat(fullPath);
      date = formatDate(info.mtime);
    } else if (date.length > 10) {
      date = date.slice(0, 10);
    }
    return {
      subdir,
      slug,
      title,
      type: frontmatter.type,
      description,
      date,
      confidence: frontmatter.confidence ?? "",
      status: frontmatter.status ?? "",
      last_verified: frontmatter.last_verified ?? "",
      review_after: frontmatter.review_after ?? "",
      archived_at: frontmatter.archived_at ?? "",
      archive_reason: frontmatter.archive_reason ?? "",
      superseded_by: frontmatter.superseded_by ?? "",
    };
  }

  async writeIndex(): Promise<void> {
    const content = await this.buildIndex();
    const target = path.join(this.workspace, INDEX_REL_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async rebuildIndex(): Promise<void> {
    await this.writeIndex();
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
