import { parseFrontmatter } from "../engine/frontmatter.js";
import { isValidPageType, normalizeWikiRelPath, validateWikiWritePath } from "../engine/wiki_org.js";
import type { Store } from "../store/interfaces.js";
import { normalizeWikiFilePath } from "./fileblocks.js";

export interface PagePlanRelation {
  target: string;
  kind: string;
}

export interface PagePlanPage {
  path: string;
  action: "create" | "update";
  type: string;
  title: string;
  document_id?: string;
  reuse_reason?: string;
  relations: PagePlanRelation[];
}

export interface AnalysisPagePlan {
  summary: string;
  pages: PagePlanPage[];
}

export class PagePlanReviewRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PagePlanReviewRequiredError";
  }
}

interface RawPagePlan {
  summary?: unknown;
  pages?: unknown;
}

export function parseAnalysisPagePlan(
  raw: string,
  options: { enforceReviewThreshold?: boolean } = {},
): AnalysisPagePlan {
  if (!raw.trim()) throw new Error("analysis is empty; refusing generation and apply");
  const json = extractPlanJson(raw);
  if (!json) throw new Error("analysis has no valid page plan; refusing generation and apply");
  let parsed: RawPagePlan;
  try {
    parsed = JSON.parse(json) as RawPagePlan;
  } catch (error) {
    throw new Error(`analysis page plan is invalid JSON: ${errorMessage(error)}`);
  }
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error("analysis page plan must contain at least one page");
  }

  const paths = new Set<string>();
  const pages = parsed.pages.map((value, index) => parsePage(value, index, paths));
  if (options.enforceReviewThreshold !== false) assertPagePlanReviewThreshold(pages);
  return { summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "", pages };
}

export async function validateAnalysisPagePlanAgainstStore(
  plan: AnalysisPagePlan,
  db: Store | null,
): Promise<void> {
  if (!db) return;
  for (const page of plan.pages) {
    const existing = await db.getDocumentByRelativePath(page.path);
    if (page.action === "create" && existing) {
      throw new Error(`page plan create 目标已存在，应改为 update: ${page.path}`);
    }
    if (page.action === "update" && !existing) {
      throw new Error(`page plan update 目标不存在: ${page.path}`);
    }
    if (existing && page.document_id && existing.id !== page.document_id) {
      throw new Error(`page plan document_id 与 path 不匹配: ${page.path}`);
    }
  }
}

export function assertGenerationMatchesPagePlan(
  blocks: Map<string, string>,
  plan: AnalysisPagePlan,
): void {
  const expected = new Map(plan.pages.map((page) => [page.path, page]));
  for (const [rawPath] of blocks) {
    const relPath = normalizeWikiFilePath(rawPath);
    if (!expected.has(relPath)) throw new Error(`生成路径未包含在 page plan 中: ${relPath}`);
  }
  for (const page of plan.pages) {
    const content = blocks.get(page.path);
    if (content === undefined) throw new Error(`生成结果缺少 page plan 页面: ${page.path}`);
    const fm = parseFrontmatter(content);
    if (fm.type !== page.type) {
      throw new Error(`页面 type 偏离 page plan: ${page.path}，期望 ${page.type}，实际 ${fm.type || "(missing)"}`);
    }
    if ((fm.title ?? "").trim() !== page.title) {
      throw new Error(`页面 title 偏离 page plan: ${page.path}`);
    }
  }
}

function parsePage(value: unknown, index: number, paths: Set<string>): PagePlanPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`page plan pages[${index}] must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const action = stringField(raw.action).toLowerCase();
  if (action !== "create" && action !== "update") {
    throw new Error(`page plan pages[${index}].action must be create or update`);
  }
  const type = stringField(raw.type).toLowerCase();
  if (!isValidPageType(type) || type === "page") {
    throw new Error(`page plan pages[${index}].type is invalid: ${type || "(missing)"}`);
  }
  const title = stringField(raw.title);
  if (!title) throw new Error(`page plan pages[${index}].title is required`);
  const relPath = normalizeWikiRelPath(normalizeWikiFilePath(stringField(raw.path)));
  validateWikiWritePath(relPath);
  if (paths.has(relPath)) throw new Error(`page plan contains duplicate path: ${relPath}`);
  paths.add(relPath);

  const reuseReason = stringField(raw.reuse_reason);
  if (action === "create" && !reuseReason) {
    throw new Error(`page plan create requires reuse_reason: ${relPath}`);
  }
  const documentID = stringField(raw.document_id);
  if (action === "update" && !relPath && !documentID) {
    throw new Error(`page plan update requires an existing document_id/path at pages[${index}]`);
  }

  const relations = parseRelations(raw.relations, index);
  return {
    path: relPath,
    action,
    type,
    title,
    ...(documentID ? { document_id: documentID } : {}),
    ...(reuseReason ? { reuse_reason: reuseReason } : {}),
    relations,
  };
}

function parseRelations(value: unknown, pageIndex: number): PagePlanRelation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`page plan pages[${pageIndex}].relations must be an array`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`page plan pages[${pageIndex}].relations[${index}] must be an object`);
    }
    const raw = entry as Record<string, unknown>;
    const target = stringField(raw.target);
    const kind = stringField(raw.kind);
    if (!target || !kind) {
      throw new Error(`page plan relation requires target and kind at pages[${pageIndex}].relations[${index}]`);
    }
    return { target, kind };
  });
}

function assertPagePlanReviewThreshold(pages: PagePlanPage[]): void {
  const business = pages.filter((page) => page.action === "create" && page.type !== "source");
  if (business.length > 3) {
    throw new PagePlanReviewRequiredError(
      `一个 source 计划新增 ${business.length} 个业务页，超过 3 个，必须转入 review 并逐页确认 reuse_reason`,
    );
  }
  const concepts = business.filter((page) => page.type === "concept").length;
  if (concepts > 2) {
    throw new PagePlanReviewRequiredError(
      `一个 source 计划包含 ${concepts} 个 concept，超过 2 个，必须转入 review 并逐页确认 reuse_reason`,
    );
  }
}

function extractPlanJson(raw: string): string {
  for (const marker of ["```json", "```"]) {
    const start = raw.indexOf(marker);
    if (start < 0) continue;
    const rest = raw.slice(start + marker.length);
    const end = rest.indexOf("```");
    if (end >= 0) return rest.slice(0, end).trim();
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1).trim() : "";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
