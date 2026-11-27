import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Store } from "../store/interfaces.js";
import { todayIsoDate } from "../store/postgres/doc_meta.js";
import type { ReferenceEntryView, WikiFolderWithCounts } from "../store/types.js";
import { normalizeCanonicalPageName } from "./canonical.js";
import { lintEntityConceptCoupling } from "./entity_concept_coupling.js";
import {
  isValidIsoDate,
  parseFrontmatter,
  titleFromFilename,
  validateFrontmatter,
  type Frontmatter,
} from "./frontmatter.js";
import {
  LINT_CODE_AMBIGUOUS_LINK,
  LINT_CODE_ARCHIVE_METADATA_INVALID,
  LINT_CODE_ARCHIVED_REFERENCE,
  LINT_CODE_CONFIDENCE_INVALID,
  LINT_CODE_CONFIDENCE_MISSING,
  LINT_CODE_DATE_INVALID,
  LINT_CODE_DEAD_LINK,
  LINT_CODE_DESCRIPTION_MISSING,
  LINT_CODE_DUPLICATE_PAGE,
  LINT_CODE_EXPERIENCE_STATUS_INVALID,
  LINT_CODE_EXPERIENCE_SHAPE_MISMATCH,
  LINT_CODE_FILENAME_NONCANONICAL,
  LINT_CODE_FOLDER_FANOUT,
  LINT_CODE_FOLDER_METADATA_MISSING,
  LINT_CODE_FRONTMATTER_INVALID,
  LINT_CODE_GHOST_INDEX_ENTRY,
  LINT_CODE_GLOBAL_DUPLICATE_PAGE,
  LINT_CODE_KIND_INVALID,
  LINT_CODE_LEGACY_TYPE_ROOT,
  LINT_CODE_MISPLACED_WIKI_PAGE,
  LINT_CODE_MISSING_FRONTMATTER,
  LINT_CODE_ORPHAN_PAGE,
  LINT_CODE_PATTERN_INSTANCES_INSUFFICIENT,
  LINT_CODE_REVIEW_OVERDUE,
  LINT_CODE_SOURCE_INVALID,
  LINT_CODE_SOURCE_METADATA_MISSING,
  LINT_CODE_SOURCES_MISSING,
  LINT_CODE_SYMPTOMS_MISSING,
  LINT_CODE_TOPIC_DEPTH_EXCEEDED,
  LINT_CODE_VERIFICATION_MISSING,
  LINT_SEVERITY_ERROR,
  LINT_SEVERITY_WARNING,
  type LintIssue,
  type LintReport,
  type LintStats,
} from "./lint_types.js";
import { validateLogMD } from "./log_validator.js";
import {
  CONFIG_STRUCTURE_POLICY_MODE,
  LEGACY_TYPE_ROOTS,
  parseStructurePolicyMode,
  type StructurePolicyMode,
} from "./placement_policy.js";
import { ReferenceParser, WIKI_DOUBLE_BRACKET_RE, WIKI_LINK_RE } from "./references.js";
import type { EngineStore } from "./store_iface.js";
import {
  classifyWikiPath,
  isValidConfidence,
  isValidExperienceKind,
  isValidExperienceStatus,
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

export interface LintPageInput extends WikiPage {
  content: string;
  referenceEntries?: ReferenceEntryView[];
}

export interface LintOptions {
  today?: string;
  rawSources?: Set<string>;
  workspaceRoot?: string;
  logContent?: string;
  sourceCount?: number;
  folders?: WikiFolderWithCounts[];
  structurePolicyMode?: StructurePolicyMode;
  approvedDeepFolders?: Set<string>;
}

interface ParsedLintPage {
  page: LintPageInput;
  fm: Frontmatter;
  archived: boolean;
  dirPath: string;
  docId: string;
}

const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;

export function lintPages(pages: LintPageInput[], options: LintOptions = {}): LintReport {
  const today = options.today || todayIsoDate();
  const issues: LintIssue[] = [];
  const pageContents = new Map<string, string>();
  const parsedPages: ParsedLintPage[] = [];
  const byRelPath = new Map<string, ParsedLintPage>();
  const rawSources = options.rawSources ?? new Set<string>();

  for (const page of pages) {
    pageContents.set(page.relPath, page.content);
    const fm = parseFrontmatter(page.content);
    const archived = Boolean(fm.archived_at);
    const dir = path.posix.dirname(`/${page.relPath}`);
    const dirPath = dir === "/" ? "/" : `${dir}/`;
    const parsed: ParsedLintPage = {
      page,
      fm,
      archived,
      dirPath,
      docId: page.relPath,
    };
    parsedPages.push(parsed);
    byRelPath.set(page.relPath, parsed);
  }

  const refParser = new ReferenceParser(
    parsedPages
      .filter((item) => !item.page.isSystem)
      .map((item) => ({
        id: item.docId,
        filename: path.posix.basename(item.page.relPath),
        title: item.fm.title || titleFromFilename(path.posix.basename(item.page.relPath)),
        path: item.dirPath,
        aliases: item.fm.aliases ?? [],
      })),
  );

  const incoming = new Map<string, number>();

  for (const item of parsedPages) {
    const { page, fm, archived } = item;
    if (page.isSystem) continue;

    if (page.isMisplaced) {
      issues.push({
        severity: LINT_SEVERITY_WARNING,
        code: LINT_CODE_MISPLACED_WIKI_PAGE,
        path: page.relPath,
        message: misplacedWikiPageMessage(page.relPath, fm.type),
      });
    }

    if (page.inTypedSubdir) {
      for (const err of fm.parse_errors ?? []) {
        issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_FRONTMATTER_INVALID,
          path: page.relPath,
          message: err,
        });
      }

      issues.push(...validateFrontmatter(page.relPath, fm, page.subdir));

      if (!archived && LEGACY_TYPE_ROOTS.has(page.subdir.toLowerCase())) {
        issues.push({
          severity: options.structurePolicyMode === "enforce" ? LINT_SEVERITY_ERROR : LINT_SEVERITY_WARNING,
          code: LINT_CODE_LEGACY_TYPE_ROOT,
          path: page.relPath,
          message: "活跃业务页仍位于 legacy 类型根，应迁移到主题域/主题组",
        });
      }

      const filename = path.posix.basename(page.relPath);
      if (!archived && (/\s/u.test(filename) || filename.includes("_"))) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_FILENAME_NONCANONICAL,
          path: page.relPath,
          message: "文件名应保留可读规范名，连续空白统一为 -，不使用 _ 分词",
        });
      }
      const h1 = /^#\s+(.+)$/m.exec(page.content)?.[1]?.trim();
      if (!archived && fm.title && h1 && normalizeCanonicalPageName(fm.title) !== normalizeCanonicalPageName(h1)) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_FILENAME_NONCANONICAL,
          path: page.relPath,
          message: `frontmatter title 与 H1 含义不一致: "${fm.title}" / "${h1}"`,
        });
      }
      if (!archived && fm.type === "concept" && experienceShapeScore(page.content) >= 3) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_EXPERIENCE_SHAPE_MISMATCH,
          path: page.relPath,
          message: "concept 正文主要呈现症状、判别、根因或验证等经验结构，请复核是否应为 experience",
        });
      }

      if ((fm.type === "experience" || fm.type === "ledger") && !fm.status) {
        issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_MISSING_FRONTMATTER,
          path: page.relPath,
          message: `${fm.type} 页面缺少必需 frontmatter 字段：status`,
        });
      }

      if (fm.confidence) {
        if (!isValidConfidence(fm.confidence)) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_CONFIDENCE_INVALID,
            path: page.relPath,
            message: `confidence 必须是 high / medium / low，当前为 "${fm.confidence}"`,
          });
        }
      } else if (!archived) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_CONFIDENCE_MISSING,
          path: page.relPath,
          message: "活跃业务页缺少 confidence",
        });
      }

      if (fm.kind) {
        if (fm.type !== "experience" || !isValidExperienceKind(fm.kind)) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_KIND_INVALID,
            path: page.relPath,
            message: `kind 只用于 experience，取值 practice / pitfall / pattern，当前 type="${fm.type}" kind="${fm.kind}"`,
          });
        }
      }

      if (fm.type === "experience" && fm.status && !isValidExperienceStatus(fm.status)) {
        issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_EXPERIENCE_STATUS_INVALID,
          path: page.relPath,
          message: `experience 的 status 必须是 draft / validated / deprecated，当前为 "${fm.status}"`,
        });
      }

      for (const [field, val] of [
        ["date", fm.date],
        ["created", fm.created ?? ""],
        ["last_verified", fm.last_verified ?? ""],
        ["review_after", fm.review_after ?? ""],
        ["archived_at", fm.archived_at ?? ""],
        ["captured_at", fm.captured_at ?? ""],
      ] as const) {
        if (val && !isValidIsoDate(val)) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_DATE_INVALID,
            path: page.relPath,
            message: `${field} 必须是有效的 YYYY-MM-DD，当前为 "${val}"`,
          });
        }
      }

      if (fm.confidence === "high" && !fm.last_verified) {
        issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_VERIFICATION_MISSING,
          path: page.relPath,
          message: "high confidence 页面缺少 last_verified",
        });
      }

      if (fm.type === "experience" && fm.status === "validated") {
        const missingFields = [
          ...(!fm.last_verified ? ["last_verified"] : []),
          ...(!fm.review_after ? ["review_after"] : []),
        ];
        if (missingFields.length > 0) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_VERIFICATION_MISSING,
            path: page.relPath,
            message: `validated 经验缺少: ${missingFields.join(", ")}`,
          });
        }
      }

      if (fm.archived_at && !fm.archive_reason) {
        issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_ARCHIVE_METADATA_INVALID,
          path: page.relPath,
          message: "已归档页缺少 archive_reason",
        });
      }
      if (!fm.archived_at && (fm.archive_reason || fm.superseded_by)) {
        issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_ARCHIVE_METADATA_INVALID,
          path: page.relPath,
          message: "archive_reason / superseded_by 需要与 archived_at 同时存在",
        });
      }

      if (!archived && fm.type === "source") {
        if (!fm.origin || !fm.captured_at) {
          const missingSrc = [
            ...(!fm.origin ? ["origin"] : []),
            ...(!fm.captured_at ? ["captured_at"] : []),
          ];
          issues.push({
            severity: LINT_SEVERITY_WARNING,
            code: LINT_CODE_SOURCE_METADATA_MISSING,
            path: page.relPath,
            message: `活跃 source 页缺少: ${missingSrc.join(", ")}`,
          });
        }
      }

      if (fm.content_hash && !SHA256_HEX_RE.test(fm.content_hash)) {
        issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_SOURCE_INVALID,
          path: page.relPath,
          message: "content_hash 必须是 64 位 SHA-256 十六进制摘要",
        });
      }

      const dbSourceEntries = (page.referenceEntries ?? []).filter((e) => e.kind === "source");
      const fmSources = fm.sources ?? [];
      const originIsConversation =
        fm.type === "source" && (fm.origin === "user-input" || fm.origin === "conversation");
      if (!archived && !originIsConversation && fmSources.length === 0 && dbSourceEntries.length === 0) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_SOURCES_MISSING,
          path: page.relPath,
          message: "活跃业务页缺少来源（sources）",
        });
      }

      for (const srcRef of fmSources) {
        const err = validateSourceRef(srcRef, item.dirPath, refParser, byRelPath, rawSources);
        if (err) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_SOURCE_INVALID,
            path: page.relPath,
            message: err,
          });
        }
      }

      if (!archived && !fm.description) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_DESCRIPTION_MISSING,
          path: page.relPath,
          message: "活跃业务页缺少 description",
        });
      }

      const expKind = fm.kind || (fm.type === "experience" ? "practice" : "");
      if (!archived && fm.type === "experience" && (expKind === "pitfall" || expKind === "pattern")) {
        if ((fm.symptoms ?? []).length === 0) {
          issues.push({
            severity: LINT_SEVERITY_WARNING,
            code: LINT_CODE_SYMPTOMS_MISSING,
            path: page.relPath,
            message: `${expKind} 经验缺少 symptoms（现象检索词）`,
          });
        }
        if (expKind === "pattern") {
          const instances = countActivePitfallInstances(
            item,
            refParser,
            byRelPath,
          );
          if (instances < 2) {
            issues.push({
              severity: LINT_SEVERITY_WARNING,
              code: LINT_CODE_PATTERN_INSTANCES_INSUFFICIENT,
              path: page.relPath,
              message: `related 中的活跃 pitfall 实例为 ${instances} 个，至少需要 2 个`,
            });
          }
        }
      }

      if (!archived && fm.review_after && isValidIsoDate(fm.review_after) && fm.review_after < today) {
        issues.push({
          severity: LINT_SEVERITY_WARNING,
          code: LINT_CODE_REVIEW_OVERDUE,
          path: page.relPath,
          message: `复审日期已过: ${fm.review_after}`,
        });
      }
    }

    // Link resolution (both body links and DB reference entries)
    const archivedRefs = new Set<string>();
    const seenIncomingFromThisPage = new Set<string>();
    const targets = extractRawLinkTargets(page.content, page.relPath);
    for (const rawTarget of targets) {
      if (rawTarget.isDoubleBracket) {
        const res = refParser.resolveLinkDetailed(rawTarget.target, item.dirPath);
        if (res.ambiguous) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_AMBIGUOUS_LINK,
            path: page.relPath,
            message: `链接有歧义 [[${rawTarget.raw}]]，请使用路径限定`,
          });
          continue;
        }
        if (!res.targetId) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_DEAD_LINK,
            path: page.relPath,
            message: `死链：目标不存在 "${rawTarget.raw}"`,
          });
          continue;
        }
        recordTargetLink(res.targetId, item, byRelPath, archivedRefs, seenIncomingFromThisPage, incoming, issues, `[[${rawTarget.raw}]]`);
      } else {
        const res = refParser.resolveLinkDetailed(rawTarget.target, item.dirPath);
        if (!res.targetId) {
          issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_DEAD_LINK,
            path: page.relPath,
            message: `死链：目标不存在 "${rawTarget.raw}"`,
          });
          continue;
        }
        recordTargetLink(res.targetId, item, byRelPath, archivedRefs, seenIncomingFromThisPage, incoming, issues, `(${rawTarget.raw})`);
      }
    }

    for (const entry of page.referenceEntries ?? []) {
      const linkText = entry.rawText.trim();
      if (!linkText) continue;
      const res = refParser.resolveLinkDetailed(linkText, item.dirPath);
      if (res.targetId) {
        recordTargetLink(res.targetId, item, byRelPath, archivedRefs, seenIncomingFromThisPage, incoming, issues, `[[${linkText}]]`);
      }
    }
  }

  issues.push(...lintEntityConceptCoupling(pages, pageContents));
  issues.push(...lintDuplicatePages(pages));
  issues.push(...lintGlobalDuplicatePages(parsedPages));
  issues.push(...lintPyramidFolders(parsedPages, options));

  for (const item of parsedPages) {
    if (item.archived || isOrphanExcluded(item.page.relPath)) continue;
    if ((incoming.get(item.page.relPath) ?? 0) === 0) {
      issues.push({
        severity: LINT_SEVERITY_WARNING,
        code: LINT_CODE_ORPHAN_PAGE,
        path: item.page.relPath,
        message: "孤立页面：无其他活跃 wiki 页面链接到此页",
      });
    }
  }

  if (options.logContent !== undefined) {
    issues.push(...validateLogMD(options.logContent));
  }

  const stats = computeStatsFromParsed(parsedPages, issues, options.sourceCount ?? rawSources.size);
  return {
    issues,
    stats,
    checked_at: new Date().toISOString(),
  };
}

function recordTargetLink(
  targetRelPath: string,
  sourceItem: ParsedLintPage,
  byRelPath: Map<string, ParsedLintPage>,
  archivedRefs: Set<string>,
  seenIncoming: Set<string>,
  incoming: Map<string, number>,
  issues: LintIssue[],
  displayLink: string,
): void {
  const target = byRelPath.get(targetRelPath);
  if (!target) return;
  if (!sourceItem.archived && target.archived && targetRelPath !== sourceItem.page.relPath && !archivedRefs.has(targetRelPath)) {
    archivedRefs.add(targetRelPath);
    issues.push({
      severity: LINT_SEVERITY_WARNING,
      code: LINT_CODE_ARCHIVED_REFERENCE,
      path: sourceItem.page.relPath,
      message: `活跃页引用了归档页 ${displayLink}`,
    });
  }
  // Archived pages do not count toward keeping active pages non-orphaned.
  if (!sourceItem.archived && targetRelPath !== sourceItem.page.relPath && !seenIncoming.has(targetRelPath)) {
    seenIncoming.add(targetRelPath);
    incoming.set(targetRelPath, (incoming.get(targetRelPath) ?? 0) + 1);
  }
}

function validateSourceRef(
  reference: string,
  docDirPath: string,
  refParser: ReferenceParser,
  byRelPath: Map<string, ParsedLintPage>,
  rawSources: Set<string>,
): string | null {
  const value = reference.trim();
  if (!value) return "空来源";
  const isWikilink = value.startsWith("[[") && value.endsWith("]]");
  const target = isWikilink ? value.slice(2, -2).split("|")[0]?.split("#")[0]?.trim() ?? "" : value;
  const res = refParser.resolveLinkDetailed(target, docDirPath);
  if (res.ambiguous) return `来源有歧义: ${value}`;
  if (res.targetId) {
    const targetPage = byRelPath.get(res.targetId);
    if (targetPage && targetPage.fm.type === "source") return null;
    if (targetPage && targetPage.page.subdir === "sources") return null;
    return `来源不是 wiki/sources 页面: ${value}`;
  }
  if (isWikilink) return `来源页不存在: ${value}`;

  const normalized = value.replace(/^\/+/, "");
  if (
    rawSources.has(normalized) ||
    rawSources.has(`raw/sources/${normalized}`) ||
    rawSources.has(path.posix.basename(normalized))
  ) {
    return null;
  }
  return `raw 来源不存在: ${value}`;
}

function countActivePitfallInstances(
  patternItem: ParsedLintPage,
  refParser: ReferenceParser,
  byRelPath: Map<string, ParsedLintPage>,
): number {
  const found = new Set<string>();
  const candidates = [
    ...(patternItem.fm.related ?? []),
    ...(patternItem.page.referenceEntries ?? [])
      .filter((e) => e.kind === "related")
      .map((e) => e.rawText),
  ];
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const target = trimmed.startsWith("[[") && trimmed.endsWith("]]")
      ? trimmed.slice(2, -2).split("|")[0]?.split("#")[0]?.trim() ?? ""
      : trimmed;
    if (!target) continue;
    const res = refParser.resolveLinkDetailed(target, patternItem.dirPath);
    if (res.ambiguous || !res.targetId || res.targetId === patternItem.page.relPath) continue;
    const targetPage = byRelPath.get(res.targetId);
    if (
      targetPage &&
      !targetPage.archived &&
      targetPage.fm.type === "experience" &&
      targetPage.fm.kind === "pitfall"
    ) {
      found.add(res.targetId);
    }
  }
  return found.size;
}

function computeStatsFromParsed(
  parsedPages: ParsedLintPage[],
  issues: LintIssue[],
  sourceCount: number,
): LintStats {
  const business = parsedPages.filter((p) => !p.page.isSystem);
  const overduePaths = new Set(
    issues.filter((i) => i.code === LINT_CODE_REVIEW_OVERDUE).map((i) => i.path),
  );
  let lastUpdated = "";
  let active = 0;
  let archived = 0;
  let draft = 0;
  let validated = 0;
  let deprecated = 0;

  for (const item of business) {
    if (item.archived) archived += 1;
    else active += 1;
    if (item.fm.status === "draft") draft += 1;
    else if (item.fm.status === "validated") validated += 1;
    else if (item.fm.status === "deprecated") deprecated += 1;
    if (item.fm.date && (!lastUpdated || item.fm.date > lastUpdated)) {
      lastUpdated = item.fm.date;
    }
  }

  return {
    page_count: business.length,
    source_count: sourceCount,
    ...(lastUpdated ? { last_updated: lastUpdated } : {}),
    active,
    archived,
    draft,
    validated,
    deprecated,
    review_overdue: overduePaths.size,
  };
}

/** Lint directly against PostgreSQL SSOT documents + structured reference entries. */
export async function lintDocuments(
  store: Store,
  options: { workspace?: string; today?: string } = {},
): Promise<LintReport> {
  const [docs, folders, storedPolicyMode] = await Promise.all([
    store.listDocumentsWithContent(),
    typeof store.listFolders === "function" ? store.listFolders(true, true).catch(() => []) : Promise.resolve([]),
    typeof store.getConfig === "function"
      ? store.getConfig(CONFIG_STRUCTURE_POLICY_MODE).catch(() => "")
      : Promise.resolve(""),
  ]);
  const rawSources = new Set<string>();
  const pages: LintPageInput[] = [];
  let sourceCount = 0;
  let logContent: string | undefined;

  for (const doc of docs) {
    if (doc.source_kind !== "wiki") {
      sourceCount += 1;
      if (doc.relative_path) rawSources.add(doc.relative_path);
      if (doc.filename) rawSources.add(doc.filename);
      continue;
    }
    const relPath = doc.relative_path;
    if (!relPath) continue;
    if (relPath === "wiki/log.md") {
      logContent = doc.content;
    }
    const kind = classifyWikiPath(relPath);
    const referenceEntries =
      typeof store.listReferenceEntries === "function"
        ? await store.listReferenceEntries(doc.id).catch(() => [])
        : [];
    pages.push({
      relPath,
      absPath: options.workspace ? path.join(options.workspace, relPath) : relPath,
      subdir: wikiSubdirFromPath(relPath),
      inTypedSubdir: kind === "typed_content",
      isSystem: kind === "system" || kind === "reserved_top_level",
      isMisplaced: kind === "misplaced",
      content: doc.content ?? "",
      referenceEntries,
    });
  }

  if (typeof store.listSourceBlobs === "function") {
    const blobs = await store.listSourceBlobs().catch(() => []);
    for (const blob of blobs) {
      if (blob.filename) rawSources.add(blob.filename);
    }
  }

  return lintPages(pages, {
    today: options.today,
    rawSources,
    workspaceRoot: options.workspace,
    logContent,
    sourceCount,
    folders,
    structurePolicyMode: parseStructurePolicyMode(storedPolicyMode),
  });
}

export async function lintWorkspace(workspace: string): Promise<LintReport> {
  const resolvedWorkspace = path.resolve(workspace);
  const diskPages = await collectWikiPages(resolvedWorkspace);
  const pages: LintPageInput[] = [];
  for (const page of diskPages) {
    const content = await readFile(page.absPath, "utf8");
    pages.push({ ...page, content });
  }

  const rawSources = new Set<string>();
  let sourceCount = 0;
  const sourcesDir = path.join(resolvedWorkspace, "raw", "sources");
  try {
    for (const entry of await readdir(sourcesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && entry.name !== ".gitkeep") {
        sourceCount += 1;
        rawSources.add(entry.name);
        rawSources.add(`raw/sources/${entry.name}`);
      }
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  let logContent: string | undefined;
  const logPath = path.join(resolvedWorkspace, "wiki", "log.md");
  try {
    logContent = await readFile(logPath, "utf8");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const report = lintPages(pages, {
    rawSources,
    workspaceRoot: resolvedWorkspace,
    logContent,
    sourceCount,
  });

  // Disk-only check: verify source content_hash against actual raw file bytes.
  for (const page of pages) {
    if (page.isSystem) continue;
    const fm = parseFrontmatter(page.content);
    if (
      fm.type === "source" &&
      fm.origin &&
      fm.origin !== "user-input" &&
      fm.origin !== "conversation" &&
      fm.content_hash &&
      SHA256_HEX_RE.test(fm.content_hash)
    ) {
      const originPath = path.resolve(resolvedWorkspace, fm.origin);
      const rawRoot = path.resolve(resolvedWorkspace, "raw");
      if (!originPath.startsWith(rawRoot + path.sep)) {
        report.issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_SOURCE_INVALID,
          path: page.relPath,
          message: `origin 必须位于 raw 内: ${fm.origin}`,
        });
        continue;
      }
      try {
        const bytes = await readFile(originPath);
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== fm.content_hash.toLowerCase()) {
          report.issues.push({
            severity: LINT_SEVERITY_ERROR,
            code: LINT_CODE_SOURCE_INVALID,
            path: page.relPath,
            message: "content_hash 与 origin 文件内容不匹配",
          });
        }
      } catch {
        report.issues.push({
          severity: LINT_SEVERITY_ERROR,
          code: LINT_CODE_SOURCE_INVALID,
          path: page.relPath,
          message: `origin 文件不存在: ${fm.origin}`,
        });
      }
    }
  }

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
        isSystem: kind === "system" || kind === "reserved_top_level",
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

interface RawLinkTarget {
  raw: string;
  target: string;
  isDoubleBracket: boolean;
}

function extractRawLinkTargets(content: string, sourceRelPath: string): RawLinkTarget[] {
  const targets: RawLinkTarget[] = [];
  const seen = new Set<string>();
  const add = (raw: string, target: string, isDoubleBracket: boolean) => {
    const key = `${isDoubleBracket ? "w" : "m"}:${target}`;
    if (!target || seen.has(key)) return;
    seen.add(key);
    targets.push({ raw, target, isDoubleBracket });
  };

  for (const match of content.matchAll(WIKI_DOUBLE_BRACKET_RE)) {
    const raw = (match[1] ?? "").trim();
    if (raw) add(raw, raw, true);
  }

  const wikiRel = wikiRelDir(sourceRelPath);
  for (const match of content.matchAll(WIKI_LINK_RE)) {
    if (match[1] === "!") continue;
    const href = (match[3] ?? "").trim();
    if (!href || isExternalOrAssetLink(href)) continue;
    add(href, resolveHrefToWikiTarget(href, wikiRel), false);
  }
  return targets;
}

export function extractLinkTargets(content: string, sourceRelPath: string): string[] {
  return extractRawLinkTargets(content, sourceRelPath).map((t) => t.target);
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

function lintGlobalDuplicatePages(parsedPages: ParsedLintPage[]): LintIssue[] {
  const groups = new Map<string, Set<string>>();
  for (const item of parsedPages) {
    if (item.archived || item.page.isSystem || !item.page.inTypedSubdir || item.page.subdir === "sources") continue;
    const filename = path.posix.basename(item.page.relPath);
    const values = [
      item.fm.title || titleFromFilename(filename),
      filename.slice(0, -path.posix.extname(filename).length),
      ...(item.fm.aliases ?? []),
    ];
    for (const value of values) {
      const key = normalizeCanonicalPageName(value);
      if (!key) continue;
      const paths = groups.get(key) ?? new Set<string>();
      paths.add(item.page.relPath);
      groups.set(key, paths);
    }
  }

  const issues = new Map<string, LintIssue>();
  for (const paths of groups.values()) {
    if (paths.size < 2) continue;
    const all = [...paths].sort();
    for (const relPath of paths) {
      if (issues.has(relPath)) continue;
      issues.set(relPath, {
        severity: LINT_SEVERITY_ERROR,
        code: LINT_CODE_GLOBAL_DUPLICATE_PAGE,
        path: relPath,
        message: `全局规范化标题、文件名或 alias 冲突: [${all.join(" ")}]`,
      });
    }
  }
  return [...issues.values()];
}

function lintPyramidFolders(parsedPages: ParsedLintPage[], options: LintOptions): LintIssue[] {
  const folderMeta = new Map((options.folders ?? []).map((folder) => [folder.path, folder]));
  const allFolders = new Set<string>();
  const directPages = new Map<string, number>();
  for (const item of parsedPages) {
    if (item.archived || !item.page.inTypedSubdir || item.page.isSystem) continue;
    const folder = path.posix.dirname(item.page.relPath).replace(/^wiki\/?/, "");
    if (!folder || folder === "." || !isTopicFolder(folder)) continue;
    directPages.set(folder, (directPages.get(folder) ?? 0) + 1);
    const parts = folder.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join("/");
      if (isTopicFolder(ancestor)) allFolders.add(ancestor);
    }
  }
  if (options.folders) {
    for (const folder of options.folders) {
      if (isTopicFolder(folder.path)) allFolders.add(folder.path);
    }
  }

  const issues: LintIssue[] = [];
  for (const folder of [...allFolders].sort()) {
    const depth = folder.split("/").length;
    const meta = folderMeta.get(folder);
    if (options.folders && (!meta?.display_name.trim() || !meta.description.trim())) {
      issues.push({
        severity: LINT_SEVERITY_WARNING,
        code: LINT_CODE_FOLDER_METADATA_MISSING,
        path: `wiki/${folder}`,
        message: "主题域/组必须填写 display_name 与收什么/不收什么/相邻边界的 description",
      });
    }
    if (depth > 3 || (depth === 3 && !options.approvedDeepFolders?.has(folder))) {
      issues.push({
        severity: depth > 3 ? LINT_SEVERITY_ERROR : LINT_SEVERITY_WARNING,
        code: LINT_CODE_TOPIC_DEPTH_EXCEEDED,
        path: `wiki/${folder}`,
        message: depth > 3 ? "主题目录超过三层" : "第三层主题目录缺少书面复核理由",
      });
    }

    const prefix = `${folder}/`;
    const childGroups = [...allFolders].filter((candidate) =>
      candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"),
    ).length;
    const pages = directPages.get(folder) ?? 0;
    const tooSmall = depth === 1 ? childGroups < 4 : childGroups === 0 && pages < 3;
    const tooLarge = depth === 1 ? childGroups > 10 : childGroups > 12 || pages > 50;
    if (tooSmall || tooLarge) {
      issues.push({
        severity: LINT_SEVERITY_WARNING,
        code: LINT_CODE_FOLDER_FANOUT,
        path: `wiki/${folder}`,
        message: `目录扇出需语义复核（主题组 ${childGroups} 个，直属页面 ${pages} 页）；不要为凑阈值自动拆并`,
      });
    }
  }
  return issues;
}

function isTopicFolder(folder: string): boolean {
  const root = folder.split("/")[0]?.toLowerCase() ?? "";
  return Boolean(root) && !LEGACY_TYPE_ROOTS.has(root) && !["sources", "templates", "raw"].includes(root);
}

function experienceShapeScore(content: string): number {
  const headings = [...content.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) =>
    (match[1] ?? "").trim().toLowerCase().replace(/[：:].*$/, ""),
  );
  const signals = ["症状", "现象", "最短判别", "根因", "处理", "验证", "复发记录", "symptoms", "root cause", "verification"];
  return new Set(headings.filter((heading) => signals.some((signal) => heading.includes(signal)))).size;
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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
