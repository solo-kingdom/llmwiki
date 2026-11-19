import { parse as parseYaml } from "yaml";
import {
  LINT_CODE_MISSING_FRONTMATTER,
  LINT_CODE_TYPE_DIR_MISMATCH,
  LINT_SEVERITY_ERROR,
  type LintIssue,
} from "./lint_types.js";
import { WIKI_SUBDIR_PAGE_TYPES } from "./wiki_org.js";

export interface Frontmatter {
  title: string;
  description: string;
  date: string;
  type: string;
  tags: string[];
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

  const expected = WIKI_SUBDIR_PAGE_TYPES[subdir];
  if (!expected) return issues;
  if (frontmatter.type !== expected) {
    issues.push({
      severity: LINT_SEVERITY_ERROR,
      code: LINT_CODE_TYPE_DIR_MISMATCH,
      path: relPath,
      message: `type 与目录不匹配：目录 ${subdir}/ 应为 type: ${expected}，实际为 ${frontmatter.type}`,
    });
  }
  return issues;
}

const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]+?\n)---[ \t]*\n/;

export function parseFrontmatter(content: string): Frontmatter {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return emptyFrontmatter();
  try {
    const parsed = parseYaml(match[1] ?? "");
    if (!parsed || typeof parsed !== "object") return emptyFrontmatter();
    const record = parsed as Record<string, unknown>;
    const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
    return {
      title: typeof record.title === "string" ? record.title : "",
      description: typeof record.description === "string" ? record.description : "",
      date: normalizeFrontmatterDate(record.date),
      type: typeof record.type === "string" ? record.type : "",
      tags,
    };
  } catch {
    return emptyFrontmatter();
  }
}

function normalizeFrontmatterDate(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  return String(value);
}

function emptyFrontmatter(): Frontmatter {
  return { title: "", description: "", date: "", type: "", tags: [] };
}

export function getTagsString(frontmatter: Frontmatter): string {
  if (frontmatter.tags.length === 0) return "[]";
  return `[${frontmatter.tags.map((tag) => `"${tag}"`).join(",")}]`;
}

export function getMetadataJSON(frontmatter: Frontmatter): string {
  if (!frontmatter.description) return "{}";
  return `{"description":"${frontmatter.description}"}`;
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
