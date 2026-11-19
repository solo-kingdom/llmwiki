export const LINT_SEVERITY_ERROR = "error";
export const LINT_SEVERITY_WARNING = "warning";
export const LINT_SEVERITY_INFO = "info";

export const LINT_CODE_DEAD_LINK = "dead_link";
export const LINT_CODE_ORPHAN_PAGE = "orphan_page";
export const LINT_CODE_MISSING_FRONTMATTER = "missing_frontmatter";
export const LINT_CODE_TYPE_DIR_MISMATCH = "type_dir_mismatch";
export const LINT_CODE_MISPLACED_WIKI_PAGE = "misplaced_wiki_page";
export const LINT_CODE_LOG_FORMAT_INVALID = "log_format_invalid";
export const LINT_CODE_LOG_DATE_DECREASING = "log_date_decreasing";
export const LINT_CODE_DUPLICATE_PAGE = "duplicate_page";
export const LINT_CODE_GHOST_INDEX_ENTRY = "ghost_index_entry";
export const LINT_CODE_ENTITY_CONCEPT_COUPLING = "entity_concept_coupling";

export interface LintIssue {
  severity: string;
  code: string;
  path: string;
  message: string;
  line?: number;
}

export interface LintStats {
  page_count: number;
  source_count: number;
  last_updated?: string;
}

export interface LintReport {
  issues: LintIssue[];
  stats: LintStats;
  checked_at: string;
}
