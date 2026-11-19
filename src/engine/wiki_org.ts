import path from "node:path";

export const WIKI_SUBDIR_PAGE_TYPES: Record<string, string> = {
  entities: "entity",
  concepts: "concept",
  sources: "source",
  synthesis: "synthesis",
  comparisons: "comparison",
  queries: "query",
};

export const PAGE_TYPE_TO_WIKI_SUBDIR: Record<string, string> = {
  entity: "entities",
  concept: "concepts",
  source: "sources",
  synthesis: "synthesis",
  comparison: "comparisons",
  query: "queries",
};

export const RESERVED_TOP_LEVEL_WIKI_PAGES = new Set([
  "wiki/overview.md",
  "wiki/index.md",
  "wiki/log.md",
]);

export const WIKI_SYSTEM_SUBDIRS = new Set(["templates"]);

export const WIKI_HIDDEN_SUBDIRS = new Set(["templates", "sources"]);

export const TYPED_WIKI_SUBDIRS = [
  "entities",
  "concepts",
  "sources",
  "synthesis",
  "comparisons",
  "queries",
];

export type WikiPathKind =
  | "other"
  | "reserved_top_level"
  | "typed_content"
  | "system"
  | "misplaced";

export function normalizeWikiRelPath(relPath: string): string {
  const trimmed = relPath.trim().replace(/^\/+/, "");
  return path.posix.normalize(trimmed).replace(/^\.\//, "");
}

export function classifyWikiPath(relPath: string): WikiPathKind {
  const normalized = normalizeWikiRelPath(relPath);
  if (!normalized || !normalized.startsWith("wiki/")) return "other";
  if (RESERVED_TOP_LEVEL_WIKI_PAGES.has(normalized)) return "reserved_top_level";
  const parts = normalized.slice("wiki/".length).split("/");
  if (parts.length >= 1 && WIKI_SYSTEM_SUBDIRS.has(parts[0] ?? "")) return "system";
  if (
    parts.length === 2 &&
    (parts[1] ?? "").toLowerCase().endsWith(".md") &&
    (parts[0] ?? "") in WIKI_SUBDIR_PAGE_TYPES
  ) {
    return "typed_content";
  }
  if (parts.length === 1 && (parts[0] ?? "").toLowerCase().endsWith(".md")) {
    return "misplaced";
  }
  return "other";
}

export function isWikiSystemPath(relPath: string): boolean {
  return classifyWikiPath(relPath) === "system";
}

export function isTypedContentWikiPage(relPath: string): boolean {
  return classifyWikiPath(relPath) === "typed_content";
}

export function wikiSubdirFromPath(relPath: string): string {
  const normalized = normalizeWikiRelPath(relPath);
  if (!normalized.startsWith("wiki/")) return "";
  return normalized.slice("wiki/".length).split("/")[0] ?? "";
}

export function wikiPageType(relPath: string): string {
  const normalized = normalizeWikiRelPath(relPath);
  if (isWikiSystemPath(normalized)) return "template";
  const subdir = wikiSubdirFromPath(normalized);
  const pageType = WIKI_SUBDIR_PAGE_TYPES[subdir];
  if (pageType && isTypedContentWikiPage(normalized)) return pageType;
  return "page";
}

export function wikiPageTypeFromPaths(relativePath: string, filePath: string): string {
  if (relativePath) return wikiPageType(relativePath);
  return wikiPageType(filePath.replace(/^\/+/, ""));
}

export function isHiddenWikiSubdir(relPath: string): boolean {
  return WIKI_HIDDEN_SUBDIRS.has(wikiSubdirFromPath(relPath));
}

export function allowedTypedWikiDirsMessage(): string {
  return TYPED_WIKI_SUBDIRS.map((dir) => `wiki/${dir}/`).join(", ");
}

export function suggestedWikiSubdirForPageType(pageType: string): string {
  return PAGE_TYPE_TO_WIKI_SUBDIR[pageType.trim()] ?? "";
}

export function misplacedWikiPageMessage(relPath: string, pageType: string): string {
  void relPath;
  let message = "业务页面不应位于 wiki/ 顶层，应放入类型子目录";
  const subdir = suggestedWikiSubdirForPageType(pageType);
  if (subdir) message += `；建议目录：wiki/${subdir}/`;
  return message;
}

export function validateWikiWritePath(relPath: string): void {
  const normalized = normalizeWikiRelPath(relPath);
  if (!normalized.startsWith("wiki/")) {
    throw new Error(`path must be under wiki/: ${normalized}`);
  }
  const kind = classifyWikiPath(normalized);
  if (kind === "system") {
    throw new Error(`cannot write to system template path: ${normalized}`);
  }
  if (kind === "misplaced") {
    throw new Error(
      `misplaced business page ${normalized}: business pages must be under ${allowedTypedWikiDirsMessage()}`,
    );
  }
  if (kind === "other") {
    throw new Error(`unsupported wiki path: ${normalized}`);
  }
}
