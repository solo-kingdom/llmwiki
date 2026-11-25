import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  LINT_CODE_MISSING_FRONTMATTER,
  LINT_CODE_TYPE_DIR_MISMATCH,
  LINT_SEVERITY_ERROR,
  type LintIssue,
} from "./lint_types.js";
import { isValidPageType } from "./wiki_org.js";

export interface Frontmatter {
  title: string;
  description: string;
  date: string;
  type: string;
  tags: string[];
  created?: string;
  confidence?: string;
  status?: string;
  kind?: string;
  last_verified?: string;
  review_after?: string;
  archived_at?: string;
  archive_reason?: string;
  superseded_by?: string;
  aliases?: string[];
  sources?: string[];
  related?: string[];
  symptoms?: string[];
  origin?: string;
  captured_at?: string;
  content_hash?: string;
  parse_errors?: string[];
}

export function validateFrontmatter(
  relPath: string,
  frontmatter: Frontmatter,
  subdir: string,
): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!frontmatter.title) {
    issues.push({
      severity: LINT_SEVERITY_ERROR,
      code: LINT_CODE_MISSING_FRONTMATTER,
      path: relPath,
      message: "缺少必需 frontmatter 字段：title",
    });
  }
  if (!frontmatter.date) {
    issues.push({
      severity: LINT_SEVERITY_ERROR,
      code: LINT_CODE_MISSING_FRONTMATTER,
      path: relPath,
      message: "缺少必需 frontmatter 字段：date",
    });
  }
  if (!frontmatter.type) {
    issues.push({
      severity: LINT_SEVERITY_ERROR,
      code: LINT_CODE_MISSING_FRONTMATTER,
      path: relPath,
      message: "缺少必需 frontmatter 字段：type",
    });
    return issues;
  }

  if (!isValidPageType(frontmatter.type)) {
    issues.push({
      severity: LINT_SEVERITY_ERROR,
      code: LINT_CODE_TYPE_DIR_MISMATCH,
      path: relPath,
      message: `无效的页面 type "${frontmatter.type}"，应为 entity / concept / source / synthesis / comparison / query / experience / ledger / page`,
    });
    return issues;
  }

  if (subdir === "sources" && frontmatter.type.trim().toLowerCase() !== "source") {
    issues.push({
      severity: LINT_SEVERITY_ERROR,
      code: LINT_CODE_TYPE_DIR_MISMATCH,
      path: relPath,
      message: `type 与目录不匹配：目录 sources/ 应为 type: source，实际为 ${frontmatter.type}`,
    });
  }
  return issues;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value.trim());
  if (!match) return false;
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function parseStringArrayField(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
): string[] {
  if (!(key in record) || record[key] == null) return [];
  const raw = record[key];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    errors.push(`${key} 必须是列表`);
    return [];
  }
  errors.push(`${key} 必须是列表`);
  return [];
}

function scalarString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return normalizeFrontmatterDate(value);
  return String(value).trim();
}

export function parseFrontmatter(content: string): Frontmatter {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return emptyFrontmatter();
  try {
    const parsed = parseYaml(match[1] ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...emptyFrontmatter(), parse_errors: ["frontmatter 必须是 YAML 对象"] };
    }
    const record = parsed as Record<string, unknown>;
    const parseErrors: string[] = [];
    const tags = parseStringArrayField(record, "tags", parseErrors);
    const aliases = parseStringArrayField(record, "aliases", parseErrors);
    const sources = parseStringArrayField(record, "sources", parseErrors);
    const related = parseStringArrayField(record, "related", parseErrors);
    const symptoms = parseStringArrayField(record, "symptoms", parseErrors);

    const fm: Frontmatter = {
      title: scalarString(record.title),
      description: scalarString(record.description),
      date: normalizeFrontmatterDate(record.date),
      type: scalarString(record.type).toLowerCase(),
      tags,
      created: normalizeFrontmatterDate(record.created),
      confidence: scalarString(record.confidence).toLowerCase(),
      status: scalarString(record.status).toLowerCase(),
      kind: scalarString(record.kind).toLowerCase(),
      last_verified: normalizeFrontmatterDate(record.last_verified),
      review_after: normalizeFrontmatterDate(record.review_after),
      archived_at: normalizeFrontmatterDate(record.archived_at),
      archive_reason: scalarString(record.archive_reason),
      superseded_by: scalarString(record.superseded_by),
      aliases,
      sources,
      related,
      symptoms,
      origin: scalarString(record.origin),
      captured_at: normalizeFrontmatterDate(record.captured_at),
      content_hash: scalarString(record.content_hash),
    };
    if (parseErrors.length > 0) fm.parse_errors = parseErrors;
    return fm;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ...emptyFrontmatter(), parse_errors: [`YAML 解析失败: ${msg}`] };
  }
}

function normalizeFrontmatterDate(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  return String(value).trim();
}

function emptyFrontmatter(): Frontmatter {
  return {
    title: "",
    description: "",
    date: "",
    type: "",
    tags: [],
    created: "",
    confidence: "",
    status: "",
    kind: "",
    last_verified: "",
    review_after: "",
    archived_at: "",
    archive_reason: "",
    superseded_by: "",
    aliases: [],
    sources: [],
    related: [],
    symptoms: [],
    origin: "",
    captured_at: "",
    content_hash: "",
  };
}

/** Insert or replace `type: <newType>` inside YAML frontmatter; adds minimal frontmatter if absent. */
export function upsertFrontmatterType(content: string, newType: string): string {
  const cleanType = newType.trim().toLowerCase();
  if (!cleanType) return content;
  return upsertFrontmatterFields(content, { type: cleanType });
}

/** Update or remove fields in YAML frontmatter while preserving other keys and body. */
export function upsertFrontmatterFields(
  content: string,
  updates: Record<string, string | string[] | undefined>,
  removeKeys: string[] = [],
): string {
  const match = FRONTMATTER_RE.exec(content);
  let record: Record<string, unknown> = {};
  let rest = content;
  if (match) {
    rest = content.slice(match[0].length);
    try {
      const parsed = parseYaml(match[1] ?? "");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      record = {};
    }
  } else {
    rest = `\n${content.replace(/^\n+/, "")}`;
  }

  for (const key of removeKeys) {
    delete record[key];
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (typeof value === "string" && value === "") {
      delete record[key];
    } else {
      record[key] = value;
    }
  }

  const yamlText = stringifyYaml(record, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlText}\n---\n${rest}`;
}

/** Append an entry line under `## 归档与重开记录` (creating the section at EOF if missing). */
export function appendArchiveHistoryEntry(content: string, entryLine: string): string {
  const cleanLine = entryLine.trim();
  if (!cleanLine) return content;
  const headingRe = /^##\s+归档与重开记录\s*$/m;
  const match = headingRe.exec(content);
  if (!match) {
    const trimmed = content.trimEnd();
    return `${trimmed}\n\n## 归档与重开记录\n\n${cleanLine}\n`;
  }
  const afterHeading = match.index + match[0].length;
  const rest = content.slice(afterHeading);
  const nextHeading = /\n##\s+/.exec(rest);
  if (!nextHeading) {
    const trimmed = content.trimEnd();
    return `${trimmed}\n${cleanLine}\n`;
  }
  const insertPos = afterHeading + nextHeading.index;
  const before = content.slice(0, insertPos).trimEnd();
  const after = content.slice(insertPos).replace(/^\n+/, "");
  return `${before}\n${cleanLine}\n\n${after}`;
}

export function getTagsString(frontmatter: Frontmatter): string {
  if (frontmatter.tags.length === 0) return "[]";
  return `[${frontmatter.tags.map((tag) => `"${tag}"`).join(",")}]`;
}

export function getMetadataJSON(frontmatter: Frontmatter): string {
  const meta: Record<string, unknown> = {};
  if (frontmatter.description) meta.description = frontmatter.description;
  if (frontmatter.created) meta.created = frontmatter.created;
  if (frontmatter.sources && frontmatter.sources.length > 0) meta.sources = frontmatter.sources;
  if (frontmatter.related && frontmatter.related.length > 0) meta.related = frontmatter.related;
  if (frontmatter.origin) meta.origin = frontmatter.origin;
  if (frontmatter.captured_at) meta.captured_at = frontmatter.captured_at;
  if (frontmatter.content_hash) meta.content_hash = frontmatter.content_hash;
  if (Object.keys(meta).length === 0) return "{}";
  return JSON.stringify(meta);
}

export function titleFromFilename(filename: string): string {
  let stem = filename;
  const dot = stem.lastIndexOf(".");
  if (dot >= 0) stem = stem.slice(0, dot);

  let result = "";
  let capitalize = true;
  for (const char of stem) {
    if (char === "-" || char === "_") {
      result += " ";
      capitalize = true;
    } else if (capitalize) {
      result += char >= "a" && char <= "z" ? char.toUpperCase() : char;
      capitalize = false;
    } else {
      result += char;
    }
  }
  return result;
}
