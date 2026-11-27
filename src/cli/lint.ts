import { lintDocuments, lintHasErrors, lintWorkspace } from "../engine/lint.js";
import {
  LINT_SEVERITY_ERROR,
  LINT_SEVERITY_INFO,
  LINT_SEVERITY_WARNING,
  type LintReport,
} from "../engine/lint_types.js";
import { openCliStore, resolveWorkspaceDir } from "./workspace.js";

export async function runLint(
  dir: string | undefined,
  asJson: boolean,
  databaseUrl?: string,
): Promise<void> {
  let report: LintReport;
  if (dir && dir.trim()) {
    const workspace = resolveWorkspaceDir(dir);
    report = await lintWorkspace(workspace);
  } else {
    const store = await openCliStore(databaseUrl);
    try {
      report = await lintDocuments(store);
    } finally {
      await store.close();
    }
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printLintHuman(report);
  }

  if (lintHasErrors(report)) {
    const errors = report.issues.filter((issue) => issue.severity === LINT_SEVERITY_ERROR).length;
    throw new Error(`lint: ${errors} error(s) found`);
  }
}

function printLintHuman(report: LintReport): void {
  const errors = report.issues.filter((issue) => issue.severity === LINT_SEVERITY_ERROR).length;
  const warnings = report.issues.filter((issue) => issue.severity === LINT_SEVERITY_WARNING).length;
  const infos = report.issues.filter((issue) => issue.severity === LINT_SEVERITY_INFO).length;

  console.log(`Wiki Lint — ${errors} 错误, ${warnings} 警告, ${infos} 信息`);
  let stats = `统计：${report.stats.page_count} 页, ${report.stats.source_count} 源文件`;
  if (report.stats.last_updated) stats += `, 最后更新 ${report.stats.last_updated}`;
  console.log(stats);

  if (report.issues.length === 0) {
    console.log("未发现问题。");
    return;
  }

  for (const issue of report.issues) {
    const location = issue.line ? `${issue.path}:${issue.line}` : issue.path;
    console.log(`[${issue.severity}] ${issue.code} ${location} — ${issue.message}`);
  }
}
