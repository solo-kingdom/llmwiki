import path from "node:path";
import { parseFrontmatter, titleFromFilename } from "./frontmatter.js";
import type { WikiPage } from "./lint.js";
import {
  LINT_CODE_ENTITY_CONCEPT_COUPLING,
  LINT_SEVERITY_WARNING,
  type LintIssue,
} from "./lint_types.js";

const MIN_ENTITY_PREFIX_RUNES = 3;

const ABSTRACT_CONCEPT_KEYWORDS = [
  "方法",
  "方法论",
  "模型",
  "文化",
  "框架",
  "策略",
  "机制",
  "理论",
  "范式",
  "实践",
  "流程",
  "体系",
  "method",
  "methodology",
  "model",
  "culture",
  "framework",
  "strategy",
  "mechanism",
  "theory",
  "paradigm",
  "practice",
  "process",
  "system",
];

interface EntityNameEntry {
  display: string;
  key: string;
}

export function lintEntityConceptCoupling(
  pages: WikiPage[],
  pageContents: Map<string, string>,
): LintIssue[] {
  const entities = collectEntityNameEntries(pages, pageContents);
  if (entities.length === 0) return [];

  const issues: LintIssue[] = [];
  for (const page of pages) {
    if (page.subdir !== "concepts" || !page.inTypedSubdir || page.isSystem) continue;
    const content = pageContents.get(page.relPath) ?? "";
    const frontmatter = parseFrontmatter(content);
    let title = frontmatter.title.trim();
    if (!title) title = titleFromFilename(path.posix.basename(page.relPath));

    const base = path.posix.basename(page.relPath);
    const ext = path.posix.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;

    const matched = matchEntityConceptCoupling(title, entities);
    if (matched) {
      issues.push(entityConceptCouplingIssue(page.relPath, matched.entity, matched.suffix, title));
      continue;
    }
    if (normalizeNameKey(title) !== normalizeNameKey(stem)) {
      const stemMatched = matchEntityConceptCoupling(stem, entities);
      if (stemMatched) {
        issues.push(
          entityConceptCouplingIssue(page.relPath, stemMatched.entity, stemMatched.suffix, stem),
        );
      }
    }
  }
  return issues;
}

function collectEntityNameEntries(
  pages: WikiPage[],
  pageContents: Map<string, string>,
): EntityNameEntry[] {
  const seen = new Set<string>();
  const entries: EntityNameEntry[] = [];

  const add = (value: string) => {
    const display = value.trim();
    if (!display) return;
    const key = normalizeNameKey(display);
    if ([...key].length < MIN_ENTITY_PREFIX_RUNES) return;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ display, key });
  };

  for (const page of pages) {
    if (page.subdir !== "entities" || !page.inTypedSubdir || page.isSystem) continue;
    const content = pageContents.get(page.relPath) ?? "";
    const frontmatter = parseFrontmatter(content);
    if (frontmatter.title) add(frontmatter.title);
    const base = path.posix.basename(page.relPath);
    const ext = path.posix.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    add(stem);
    add(titleFromFilename(stem));
  }
  return entries;
}

function matchEntityConceptCoupling(
  name: string,
  entities: EntityNameEntry[],
): { entity: string; suffix: string } | null {
  const key = normalizeNameKey(name);
  if (!key) return null;
  for (const entity of entities) {
    if (!key.startsWith(entity.key) || key.length <= entity.key.length) continue;
    const suffix = key.slice(entity.key.length);
    if (!hasAbstractConceptKeyword(suffix)) continue;
    return { entity: entity.display, suffix };
  }
  return null;
}

function hasAbstractConceptKeyword(suffixKey: string): boolean {
  if (!suffixKey) return false;
  const lower = suffixKey.toLowerCase();
  return ABSTRACT_CONCEPT_KEYWORDS.some((keyword) =>
    lower.includes(normalizeNameKey(keyword)),
  );
}

export function normalizeNameKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[ _\-　]/g, "");
}

function entityConceptCouplingIssue(
  relPath: string,
  entityDisplay: string,
  suffixKey: string,
  title: string,
): LintIssue {
  void suffixKey;
  return {
    severity: LINT_SEVERITY_WARNING,
    code: LINT_CODE_ENTITY_CONCEPT_COUPLING,
    path: relPath,
    message: `概念标题疑似绑定实体 "${entityDisplay}"：标题 "${title}" 建议拆为中性概念页，并通过 [[${entityDisplay}]] 链接案例`,
  };
}
