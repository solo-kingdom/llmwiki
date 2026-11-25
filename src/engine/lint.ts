import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, validateFrontmatter } from "./frontmatter.js";
import { lintEntityConceptCoupling } from "./entity_concept_coupling.js";
import {
  LINT_CODE_DEAD_LINK,
  LINT_CODE_DUPLICATE_PAGE,
  LINT_CODE_GHOST_INDEX_ENTRY,
  LINT_CODE_MISPLACED_WIKI_PAGE,
  LINT_CODE_ORPHAN_PAGE,
  LINT_SEVERITY_ERROR,
  LINT_SEVERITY_WARNING,
  type LintIssue,
  type LintReport,
  type LintStats,
} from "./lint_types.js";
import { validateLogMD } from "./log_validator.js";
import { WIKI_DOUBLE_BRACKET_RE, WIKI_LINK_RE } from "./references.js";
import type { EngineStore } from "./store_iface.js";
import {
  classifyWikiPath,
  isWikiSystemPath,
  misplacedWikiPageMessage,
  wikiSubdirFromPath,
} from "./wiki_org.js";

export interface WikiPage {
  relPath: string;
  absPath: string;
  subdir: string;
  inTypedSubdir: boolean;
  isSystem: boolean;
  isMisplaced: boolean;
}

export async function lintWorkspace(workspace: string): Promise<LintReport> {
  const resolvedWorkspace = path.resolve(workspace);
  const report: LintReport = {
    issues: [],
    stats: { page_count: 0, source_count: 0 },
    checked_at: new Date().toISOString(),
  };

  const pages = await collectWikiPages(resolvedWorkspace);
  const pathIndex = buildWikiPathIndex(pages);
  const incoming = new Map<string, number>();
  const pageContents = new Map<string, string>();

  for (const page of pages) {
    const text = await readFile(page.absPath, "utf8");
    pageContents.set(page.relPath, text);

    if (page.isSystem) continue;

    if (page.inTypedSubdir) {
      const frontmatter = parseFrontmatter(text);
      report.issues.push(...validateFrontmatter(page.relPath, frontmatter, page.subdir));
    }
    if (page.isMisplaced) {
      const frontmatter = parseFrontmatter(text);
      report.issues.push({
        severity: LINT_SEVERITY_WARNING,
        code: LINT_CODE_MISPLACED_WIKI_PAGE,
        path: page.relPath,
        message: misplacedWikiPageMessage(page.relPath, frontmatter.type),
      });
    }

    for (const target of extractLinkTargets(text, page.relPath)) {
      if (!wikiTargetExists(pathIndex, target)) {
        report.issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_DEAD_LINK,
          path: page.relPath,
          message: `死链：目标不存在 "${target}"`,
        });
      } else {
        const resolved = resolveWikiTarget(pathIndex, target);
        if (resolved) incoming.set(resolved, (incoming.get(resolved) ?? 0) + 1);
      }
    }
  }

  report.issues.push(...lintEntityConceptCoupling(pages, pageContents));
  report.issues.push(...lintDuplicatePages(pages));

  for (const page of pages) {
    if (isOrphanExcluded(page.relPath)) continue;
    if ((incoming.get(page.relPath) ?? 0) === 0) {
      report.issues.push({
        severity: LINT_SEVERITY_WARNING,
        code: LINT_CODE_ORPHAN_PAGE,
        path: page.relPath,
        message: "孤立页面：无其他 wiki 页面链接到此页",
      });
    }
  }

  const logPath = path.join(resolvedWorkspace, "wiki", "log.md");
  try {
    report.issues.push(...validateLogMD(await readFile(logPath, "utf8")));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  report.stats = await computeLintStats(resolvedWorkspace, pages);
  return report;
}

export function lintHasErrors(report: LintReport): boolean {
  return report.issues.some((issue) => issue.severity === LINT_SEVERITY_ERROR);
}

export async function collectWikiPages(workspace: string): Promise<WikiPage[]> {
  const wikiRoot = path.join(workspace, "wiki");
  const pages: WikiPage[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md") || entry.name === ".gitkeep") continue;
      const relPath = path.relative(workspace, fullPath).split(path.sep).join("/");
      const kind = classifyWikiPath(relPath);
      pages.push({
        relPath,
        absPath: fullPath,
        subdir: wikiSubdirFromPath(relPath),
        inTypedSubdir: kind === "typed_content",
        isSystem: kind === "system",
        isMisplaced: kind === "misplaced",
      });
    }
  }

  await walk(wikiRoot);
  return pages;
}

/** Map every accepted alias (full path, path without .md, basename) to the
 * canonical page path, so orphan checks compare against `page.relPath`. */
export function buildWikiPathIndex(pages: WikiPage[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const page of pages) {
    index.set(page.relPath.toLowerCase(), page.relPath);
    const base = path.posix.basename(page.relPath).toLowerCase();
    const stem = base.endsWith(".md") ? base.slice(0, -3) : base;
    const dir = path.posix.dirname(page.relPath);
    if (dir !== ".") index.set(`${dir}/${stem}`.toLowerCase(), page.relPath);
    index.set(stem.toLowerCase(), page.relPath);
  }
  return index;
}

export function extractLinkTargets(content: string, sourceRelPath: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    targets.push(trimmed);
  };

  for (const match of content.matchAll(WIKI_DOUBLE_BRACKET_RE)) {
    add(match[1] ?? "");
  }

  const wikiRel = wikiRelDir(sourceRelPath);
  for (const match of content.matchAll(WIKI_LINK_RE)) {
    if (match[1] === "!") continue;
    const href = match[3] ?? "";
    if (isExternalOrAssetLink(href)) continue;
    add(resolveHrefToWikiTarget(href, wikiRel));
  }
  return targets;
}

function wikiRelDir(relPath: string): string {
  const normalized = relPath.split(path.sep).join("/");
  if (!normalized.startsWith("wiki/")) return "";
  const dir = path.posix.dirname(normalized);
  if (dir === "wiki") return "";
  return `${dir.replace(/^wiki\//, "")}/`;
}

function resolveHrefToWikiTarget(href: string, wikiRel: string): string {
  const value = href.trim();
  if (!value) return "";
  if (value.startsWith("/wiki/")) return value.slice("/wiki/".length);
  if (value.startsWith("wiki/")) return value.slice("wiki/".length);
  if (value.startsWith("./")) return normalizeWikiPath(wikiRel + value.slice(2));
  if (value.startsWith("../")) return normalizeWikiPath(wikiRel + value);
  if (!value.includes("/")) return normalizeWikiPath(wikiRel + value);
  return normalizeWikiPath(value);
}

function normalizeWikiPath(value: string): string {
  const clean: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (clean.length > 0) clean.pop();
    } else {
      clean.push(part);
    }
  }
  return clean.join("/");
}

function wikiTargetExists(index: Map<string, string>, target: string): boolean {
  return resolveWikiTarget(index, target) !== "";
}

export function resolveWikiTarget(index: Map<string, string>, target: string): string {
  const trimmed = target.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  // Links often write spaces where filenames/titles use underscores
  // ([[Adam Foroughi]] vs Adam_Foroughi.md); check both variants.
  const variants = new Set([trimmed, trimmed.replace(/ /g, "_"), trimmed.replace(/_/g, " ")]);
  for (const variant of variants) {
    const lower = variant.toLowerCase();
    const candidates = [`wiki/${lower}`, `wiki/${lower}.md`, lower, `${lower}.md`];
    for (const candidate of candidates) {
      const resolved = index.get(candidate);
      if (resolved) return resolved;
    }
  }
  return "";
}

function isExternalOrAssetLink(href: string): boolean {
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("#") ||
    href.startsWith("mailto:")
  ) {
    return true;
  }
  const lower = href.toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].some((ext) => lower.endsWith(ext));
}

function isOrphanExcluded(relPath: string): boolean {
  const normalized = relPath.split(path.sep).join("/");
  if (isWikiSystemPath(normalized)) return true;
  if (["wiki/index.md", "wiki/log.md", "wiki/overview.md"].includes(normalized)) return true;
  if (normalized.startsWith("wiki/sources/")) {
    return !normalized.slice("wiki/sources/".length).includes("/");
  }
  return false;
}

function normalizeNameKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ _\-　]/g, "");
}

function lintDuplicatePages(pages: WikiPage[]): LintIssue[] {
  const groups = new Map<string, WikiPage[]>();
  for (const page of pages) {
    if (!page.inTypedSubdir || page.isSystem) continue;
    const dir = path.posix.dirname(page.relPath);
    const list = groups.get(dir) ?? [];
    list.push(page);
    groups.set(dir, list);
  }

  const issues: LintIssue[] = [];
  for (const group of groups.values()) {
    const normalized = new Map<string, string[]>();
    for (const page of group) {
      const base = path.posix.basename(page.relPath);
      const ext = path.posix.extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      const key = normalizeNameKey(stem);
      const list = normalized.get(key) ?? [];
      list.push(page.relPath);
      normalized.set(key, list);
    }
    for (const paths of normalized.values()) {
      if (paths.length < 2) continue;
      for (const relPath of paths) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_DUPLICATE_PAGE,
          path: relPath,
          message: `疑似重复页面：同目录下存在归一化文件名相同的页面 [${paths.join(" ")}]`,
        });
      }
    }
  }
  return issues;
}

export async function lintGhostIndexEntries(
  workspace: string,
  store: EngineStore,
): Promise<LintIssue[]> {
  const resolvedWorkspace = path.resolve(workspace);
  const docs = await store.listAllDocuments();
  const issues: LintIssue[] = [];
  for (const doc of docs) {
    const rel = docRelativePath(doc);
    if (!rel) continue;
    const fullPath = path.join(resolvedWorkspace, rel);
    try {
      await stat(fullPath);
      continue;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    issues.push({
      severity: LINT_SEVERITY_ERROR,
      code: LINT_CODE_GHOST_INDEX_ENTRY,
      path: rel,
      message: "索引幽灵页：数据库中存在但文件已缺失，请运行 reindex 或删除整理残留",
    });
  }
  return issues;
}

export function docRelativePath(doc: { path: string; filename: string }): string {
  return `${doc.path.replace(/^\/+/, "")}${doc.filename}`;
}

async function computeLintStats(workspace: string, pages: WikiPage[]): Promise<LintStats> {
  const stats: LintStats = { page_count: 0, source_count: 0 };
  for (const page of pages) {
    if (!page.isSystem) stats.page_count += 1;
  }

  const sourcesDir = path.join(workspace, "raw", "sources");
  try {
    for (const entry of await readdir(sourcesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && entry.name !== ".gitkeep") stats.source_count += 1;
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  let lastDate = "";
  for (const page of pages) {
    if (page.isSystem) continue;
    try {
      const frontmatter = parseFrontmatter(await readFile(page.absPath, "utf8"));
      if (frontmatter.date && (!lastDate || frontmatter.date > lastDate)) {
        lastDate = frontmatter.date;
      }
    } catch {
      continue;
    }
  }
  if (lastDate) stats.last_updated = lastDate;
  return stats;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
