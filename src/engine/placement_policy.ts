import {
  folderPathFromWikiRelPath,
  isCanonicalWikiSlugPath,
  isFolderOverviewPath,
  normalizeWikiRelPath,
  RESERVED_TOP_LEVEL_WIKI_PAGES,
  validateWikiWritePath,
  wikiSubdirFromPath,
} from "./wiki_org.js";

export const CONFIG_STRUCTURE_POLICY_MODE = "structure_policy_mode";

export const STRUCTURE_POLICY_MODES = ["legacy", "report", "enforce"] as const;
export type StructurePolicyMode = (typeof STRUCTURE_POLICY_MODES)[number];

export const OPEN_AUTO_FOLDER_DOMAINS = new Set(["products"]);

export type WikiWriteOrigin =
  | "auto_ingest"
  | "manual"
  | "migration"
  | "rollback"
  | "reindex";

export interface WikiPlacementContext {
  mode: StructurePolicyMode;
  origin: WikiWriteOrigin;
  existing: boolean;
  folders: ReadonlySet<string>;
}

export interface WikiPlacementDecision {
  path: string;
  legacy: boolean;
  warnings: string[];
}

export const LEGACY_TYPE_ROOTS = new Set([
  "concepts",
  "entities",
  "devices",
  "synthesis",
  "comparisons",
  "queries",
  "experiences",
  "ledgers",
]);

export function parseStructurePolicyMode(raw: string): StructurePolicyMode {
  const value = raw.trim().toLowerCase();
  if (!value) return "legacy";
  if (value === "legacy" || value === "report" || value === "enforce") return value;
  throw new Error(`structure_policy_mode must be legacy, report, or enforce; got "${raw}"`);
}

export function writeOriginForChangeSet(kind: string): WikiWriteOrigin {
  switch (kind.trim().toLowerCase()) {
    case "ingest":
    case "review_apply":
      return "auto_ingest";
    case "import":
    case "migration":
      return "migration";
    case "rollback":
      return "rollback";
    case "reindex":
      return "reindex";
    default:
      return "manual";
  }
}

export function evaluateWikiPlacement(
  relPath: string,
  context: WikiPlacementContext,
): WikiPlacementDecision {
  const normalized = normalizeWikiRelPath(relPath);
  validateWikiWritePath(normalized);
  const decision: WikiPlacementDecision = { path: normalized, legacy: false, warnings: [] };
  if (
    RESERVED_TOP_LEVEL_WIKI_PAGES.has(normalized) ||
    normalized.startsWith("wiki/sources/") ||
    context.origin === "migration" ||
    context.origin === "rollback" ||
    context.origin === "reindex" ||
    context.mode === "legacy"
  ) {
    return decision;
  }

  decision.legacy = LEGACY_TYPE_ROOTS.has(wikiSubdirFromPath(normalized).toLowerCase());
  if (decision.legacy) {
    if (context.origin === "auto_ingest" && context.existing) {
      decision.warnings.push(`旧页面原地更新，允许保留 legacy 路径直至迁移: ${normalized}`);
      return decision;
    }
    if (context.mode === "enforce" && context.origin === "auto_ingest") {
      throw new Error(`新自动业务页禁止写入 legacy 类型根: ${normalized}`);
    }
    decision.warnings.push(`legacy 类型根仅用于兼容，请迁移到主题域/主题组: ${normalized}`);
    return decision;
  }

  if (context.mode !== "enforce" || context.origin !== "auto_ingest" || context.existing) {
    if (
      context.mode === "report" &&
      context.origin === "auto_ingest" &&
      !context.existing &&
      !isCanonicalWikiSlugPath(normalized)
    ) {
      decision.warnings.push(`路径不符合 A1 英文 kebab-case slug 规范: ${normalized}`);
    }
    return decision;
  }
  const folder = folderPathFromWikiRelPath(normalized);
  const depth = folder ? folder.split("/").length : 0;
  if (depth < 2 || depth > 3) {
    throw new Error(`新自动业务页必须位于已登记的主题域/主题组（默认两层，例外最多三层）: ${normalized}`);
  }
  if (!context.folders.has(folder)) {
    throw new Error(`目标主题组未登记，自动 job 不得直接创建新主题目录: ${folder}`);
  }
  if (!isFolderOverviewPath(normalized) && !isCanonicalWikiSlugPath(normalized)) {
    throw new Error(`新自动业务页路径必须符合全英文小写 kebab-case slug 规范: ${normalized}`);
  }
  return decision;
}
