import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, titleFromFilename } from "./frontmatter.js";

export const INDEX_REL_PATH = "wiki/index.md";

interface WikiSubdir {
  dir: string;
  heading: string;
}

const WIKI_SUBDIRS: WikiSubdir[] = [
  { dir: "entities", heading: "实体 (entities)" },
  { dir: "concepts", heading: "概念 (concepts)" },
  { dir: "sources", heading: "源摘要 (sources)" },
  { dir: "synthesis", heading: "综合分析 (synthesis)" },
  { dir: "comparisons", heading: "对比分析 (comparisons)" },
  { dir: "queries", heading: "查询归档 (queries)" },
];

export interface IndexEntry {
  subdir: string;
  slug: string;
  title: string;
  description: string;
  date: string;
}

const SYSTEM_WIKI_PATHS = new Set(["wiki/index.md", "wiki/log.md", "wiki/overview.md"]);

export interface IndexSourceDocument {
  relative_path?: string;
  title?: string;
  date?: string;
  updated_at?: string;
  content?: string;
  source_kind?: string;
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
    list.push({ subdir, slug, title, description, date });
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

    for (const dir of orderedDirs) {
      const heading = headings.get(dir) ?? dir;
      output += `## ${heading}\n\n`;
      output += "| 页面 | 标题 | 摘要 | 更新日期 |\n";
      output += "|------|------|------|----------|\n";
      const entries = entriesBySubdir?.get(dir) ?? [];
      for (const entry of entries) {
        const link = `[[${entry.subdir}/${entry.slug}\\|${escapeGFMTableCell(entry.title)}]]`;
        output += `| ${link} | ${escapeGFMTableCell(entry.title)} | ${escapeGFMTableCell(entry.description)} | ${escapeGFMTableCell(entry.date)} |\n`;
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
    const description = truncateRunes(frontmatter.description, 80);
    let date = frontmatter.date;
    if (!date) {
      const info = await stat(fullPath);
      date = formatDate(info.mtime);
    } else if (date.length > 10) {
      date = date.slice(0, 10);
    }
    return { subdir, slug, title, description, date };
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
