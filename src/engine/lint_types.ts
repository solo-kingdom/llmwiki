export const LINT_SEVERITY_ERROR = "error";
export const LINT_SEVERITY_WARNING = "warning";
export const LINT_SEVERITY_INFO = "info";

export const LINT_CODE_FRONTMATTER_INVALID = "frontmatter_invalid";
export const LINT_CODE_DEAD_LINK = "dead_link";
export const LINT_CODE_AMBIGUOUS_LINK = "ambiguous_link";
export const LINT_CODE_ORPHAN_PAGE = "orphan_page";
export const LINT_CODE_MISSING_FRONTMATTER = "missing_frontmatter";
export const LINT_CODE_TYPE_DIR_MISMATCH = "type_dir_mismatch";
export const LINT_CODE_MISPLACED_WIKI_PAGE = "misplaced_wiki_page";
export const LINT_CODE_LOG_FORMAT_INVALID = "log_format_invalid";
export const LINT_CODE_LOG_DATE_DECREASING = "log_date_decreasing";
export const LINT_CODE_DUPLICATE_PAGE = "duplicate_page";
export const LINT_CODE_GHOST_INDEX_ENTRY = "ghost_index_entry";
export const LINT_CODE_ENTITY_CONCEPT_COUPLING = "entity_concept_coupling";
export const LINT_CODE_CONFIDENCE_INVALID = "confidence_invalid";
export const LINT_CODE_CONFIDENCE_MISSING = "confidence_missing";
export const LINT_CODE_VERIFICATION_MISSING = "verification_missing";
export const LINT_CODE_DATE_INVALID = "date_invalid";
export const LINT_CODE_ARCHIVE_METADATA_INVALID = "archive_metadata_invalid";
export const LINT_CODE_KIND_INVALID = "kind_invalid";
export const LINT_CODE_EXPERIENCE_STATUS_INVALID = "experience_status_invalid";
export const LINT_CODE_SOURCE_INVALID = "source_invalid";
export const LINT_CODE_SOURCES_MISSING = "sources_missing";
export const LINT_CODE_SOURCE_METADATA_MISSING = "source_metadata_missing";
export const LINT_CODE_DESCRIPTION_MISSING = "description_missing";
export const LINT_CODE_SYMPTOMS_MISSING = "symptoms_missing";
export const LINT_CODE_PATTERN_INSTANCES_INSUFFICIENT = "pattern_instances_insufficient";
export const LINT_CODE_REVIEW_OVERDUE = "review_overdue";
export const LINT_CODE_ARCHIVED_REFERENCE = "archived_reference";

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
  active: number;
  archived: number;
  draft: number;
  validated: number;
  deprecated: number;
  review_overdue: number;
}

export interface LintReport {
  issues: LintIssue[];
  stats: LintStats;
  checked_at: string;
}
