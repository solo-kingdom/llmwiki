import {
  LINT_CODE_LOG_DATE_DECREASING,
  LINT_CODE_LOG_FORMAT_INVALID,
  LINT_SEVERITY_ERROR,
  type LintIssue,
} from "./lint_types.js";

export const LOG_REL_PATH = "wiki/log.md";

const LOG_ENTRY_RE = /^## \[(\d{4}-\d{2}-\d{2})\] .+ \| .+$/;

export function validateLogMD(content: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const dates: string[] = [];
  const dateLines: number[] = [];

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed.startsWith("## [")) continue;
    if (!LOG_ENTRY_RE.test(trimmed)) {
      issues.push({
        severity: LINT_SEVERITY_ERROR,
        code: LINT_CODE_LOG_FORMAT_INVALID,
        path: LOG_REL_PATH,
        line: lineNumber,
        message: `日志条目格式无效，应为 ## [YYYY-MM-DD] action | description（第 ${lineNumber} 行）`,
      });
      continue;
    }
    const match = LOG_ENTRY_RE.exec(trimmed);
    if (match?.[1]) {
      dates.push(match[1]);
      dateLines.push(lineNumber);
    }
  }

  for (let i = 1; i < dates.length; i += 1) {
    if ((dates[i] ?? "") < (dates[i - 1] ?? "")) {
      issues.push({
        severity: LINT_SEVERITY_ERROR,
        code: LINT_CODE_LOG_DATE_DECREASING,
        path: LOG_REL_PATH,
        line: dateLines[i],
        message: `日志日期非递增：${dates[i]} 早于前一条 ${dates[i - 1]}`,
      });
    }
  }
  return issues;
}
