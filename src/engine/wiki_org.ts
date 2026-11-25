import path from "node:path";

export const VALID_PAGE_TYPES = [
  "entity",
  "concept",
  "source",
  "synthesis",
  "comparison",
  "query",
  "experience",
  "ledger",
  "page",
] as const;

export type WikiPageType = (typeof VALID_PAGE_TYPES)[number];

const VALID_PAGE_TYPE_SET = new Set<string>(VALID_PAGE_TYPES);

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
const CONFIDENCE_LEVEL_SET = new Set<string>(CONFIDENCE_LEVELS);

export const EXPERIENCE_KINDS = ["practice", "pitfall", "pattern"] as const;
export type ExperienceKind = (typeof EXPERIENCE_KINDS)[number];
const EXPERIENCE_KIND_SET = new Set<string>(EXPERIENCE_KINDS);

export const EXPERIENCE_STATUSES = ["draft", "validated", "deprecated"] as const;
export type ExperienceStatus = (typeof EXPERIENCE_STATUSES)[number];
const EXPERIENCE_STATUS_SET = new Set<string>(EXPERIENCE_STATUSES);

export const WIKI_SUBDIR_PAGE_TYPES: Record<string, string> = {
  entities: "entity",
  concepts: "concept",
  sources: "source",
  synthesis: "synthesis",
  comparisons: "comparison",
  queries: "query",
  experiences: "experience",
  ledgers: "ledger",
};

export const PAGE_TYPE_TO_WIKI_SUBDIR: Record<string, string> = {
  entity: "entities",
  concept: "concepts",
  source: "sources",
  synthesis: "synthesis",
  comparison: "comparisons",
  query: "queries",
  experience: "experiences",
  ledger: "ledgers",
};

export const RESERVED_TOP_LEVEL_WIKI_PAGES = new Set([
  "wiki/overview.md",
  "wiki/index.md",
  "wiki/log.md",
]);

export const WIKI_SYSTEM_SUBDIRS = new Set(["templates"]);

export const WIKI_HIDDEN_SUBDIRS = new Set(["templates", "sources"]);

export const RESERVED_FOLDER_ROOTS = new Set(["templates", "sources", "raw"]);

export const MAX_FOLDER_DEPTH = 8;

export const TYPED_WIKI_SUBDIRS = [
  "entities",
  "concepts",
  "sources",
  "synthesis",
  "comparisons",
  "queries",
  "experiences",
  "ledgers",
];

export type WikiPathKind =
  | "other"
  | "reserved_top_level"
  | "typed_content"
  | "system"
  | "misplaced";

export function isValidPageType(value: string): boolean {
  return VALID_PAGE_TYPE_SET.has(value.trim().toLowerCase());
}

export function isValidConfidence(value: string): boolean {
  return CONFIDENCE_LEVEL_SET.has(value.trim().toLowerCase());
}

export function isValidExperienceKind(value: string): boolean {
  return EXPERIENCE_KIND_SET.has(value.trim().toLowerCase());
}

export function isValidExperienceStatus(value: string): boolean {
  return EXPERIENCE_STATUS_SET.has(value.trim().toLowerCase());
}

export function normalizeWikiRelPath(relPath: string): string {
  const trimmed = relPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed) return "";
  return path.posix.normalize(trimmed).replace(/^\.\//, "");
}

/** Normalize a folder path relative to `wiki/` (no leading/trailing slashes). */
export function normalizeFolderPath(raw: string): string {
  let value = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (value === "wiki") return "";
  if (value.startsWith("wiki/")) value = value.slice("wiki/".length);
  return value.replace(/^\/+|\/+$/g, "");
}

/** Validate a user/API-managed folder path (relative to `wiki/`, 1..8 segments). */
export function validateFolderPath(raw: string): string {
  const normalized = normalizeFolderPath(raw);
  if (!normalized) {
    throw new Error("folder path is required");
  }
  if (normalized.includes("//")) {
    throw new Error(`invalid folder path (empty segment): ${raw}`);
  }
  const segments = normalized.split("/");
  if (segments.length > MAX_FOLDER_DEPTH) {
    throw new Error(`folder depth exceeds maximum (${MAX_FOLDER_DEPTH}): ${normalized}`);
  }
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i] ?? "";
    if (!seg || seg === "." || seg === "..") {
      throw new Error(`invalid folder segment "${seg}" in path: ${normalized}`);
    }
    if (seg.startsWith(".")) {
      throw new Error(`hidden folder segment "${seg}" is not allowed: ${normalized}`);
    }
    if (/[\x00-\x1f\x7f\\]/.test(seg)) {
      throw new Error(`control characters or backslashes are not allowed in folder path: ${normalized}`);
    }
    if ([...seg].length > 120) {
      throw new Error(`folder segment exceeds 120 characters: ${seg}`);
    }
    if (i === 0 && RESERVED_FOLDER_ROOTS.has(seg.toLowerCase())) {
      throw new Error(`reserved top-level folder "${seg}" cannot be managed as a topic folder`);
    }
  }
  return normalized;
}

/** Validate a folder path if it is non-empty, or return "" for root. */
export function validateOptionalFolderPath(raw: string): string {
  const normalized = normalizeFolderPath(raw);
  if (!normalized) return "";
  return validateFolderPath(normalized);
}

/** Return all ancestor folder paths including the path itself, e.g. "a/b/c" -> ["a","a/b","a/b/c"]. */
export function ancestorFolderPaths(folderPath: string): string[] {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return [];
  const parts = normalized.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    out.push(parts.slice(0, i + 1).join("/"));
  }
  return out;
}

/** Extract folder path relative to `wiki/` from a document relative_path; "" if root/non-wiki. */
export function folderPathFromWikiRelPath(relPath: string): string {
  const normalized = normalizeWikiRelPath(relPath);
  if (!normalized.startsWith("wiki/")) return "";
  const rest = normalized.slice("wiki/".length);
  const lastSlash = rest.lastIndexOf("/");
  if (lastSlash < 0) return "";
  return rest.slice(0, lastSlash);
}

function isSafeWikiSubpathSegments(segments: string[], allowSourcesRoot: boolean): boolean {
  if (segments.length === 0 || segments.length > MAX_FOLDER_DEPTH) return false;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i] ?? "";
    if (!seg || seg === "." || seg === ".." || seg.startsWith(".")) return false;
    if (/[\x00-\x1f\x7f\\]/.test(seg)) return false;
    if ([...seg].length > 120) return false;
    if (i === 0) {
      const lower = seg.toLowerCase();
      if (lower === "templates" || lower === "raw") return false;
      if (!allowSourcesRoot && lower === "sources") return false;
    }
  }
  return true;
}

export function classifyWikiPath(relPath: string): WikiPathKind {
  const normalized = normalizeWikiRelPath(relPath);
  if (!normalized || !normalized.startsWith("wiki/")) return "other";
  if (RESERVED_TOP_LEVEL_WIKI_PAGES.has(normalized)) return "reserved_top_level";
  const parts = normalized.slice("wiki/".length).split("/");
  if (parts.length >= 1 && WIKI_SYSTEM_SUBDIRS.has(parts[0] ?? "")) return "system";
  if (parts.length === 1 && (parts[0] ?? "").toLowerCase().endsWith(".md")) {
    return "misplaced";
  }
  if (parts.length >= 2) {
    const filename = parts[parts.length - 1] ?? "";
    const folderParts = parts.slice(0, -1);
    if (
      filename.toLowerCase().endsWith(".md") &&
      filename !== "." &&
      filename !== ".." &&
      !filename.startsWith(".") &&
      isSafeWikiSubpathSegments(folderParts, true)
    ) {
      return "typed_content";
    }
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

/** Resolve page_type with priority: explicit/frontmatter > special subdirs > legacy subdir > "page". */
export function resolvePageType(
  frontmatterType: string,
  explicitType: string,
  relPath: string,
): string {
  const normalized = normalizeWikiRelPath(relPath);
  if (isWikiSystemPath(normalized)) return "template";
  const subdir = wikiSubdirFromPath(normalized);
  if (subdir === "sources") return "source";

  const fm = frontmatterType.trim().toLowerCase();
  if (fm && isValidPageType(fm)) return fm;

  const exp = explicitType.trim().toLowerCase();
  if (exp && isValidPageType(exp)) return exp;

  const legacy = WIKI_SUBDIR_PAGE_TYPES[subdir];
  if (legacy && isTypedContentWikiPage(normalized)) return legacy;

  return "page";
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
  let message = "业务页面不应位于 wiki/ 顶层，应放入主题子目录";
  const subdir = suggestedWikiSubdirForPageType(pageType);
  if (subdir) message += `（或参考原分类目录：wiki/${subdir}/）`;
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
      `misplaced business page ${normalized}: business pages must be placed inside a wiki subfolder (e.g. wiki/topic/page.md)`,
    );
  }
  if (kind === "other") {
    throw new Error(`unsupported wiki path: ${normalized}`);
  }
}
