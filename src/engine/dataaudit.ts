export type DataClassification = "file_truth" | "db_derived" | "db_cached";

export interface FieldAudit {
  field: string;
  classification: DataClassification;
  description: string;
}

export function persistenceAudit(): FieldAudit[] {
  return [
    { field: "content", classification: "file_truth", description: "Markdown file content — canonical source of truth" },
    { field: "filename", classification: "file_truth", description: "Derived from file path on disk" },
    { field: "title", classification: "file_truth", description: "From YAML frontmatter or filename-derived" },
    { field: "path", classification: "file_truth", description: "Directory path on disk" },
    { field: "relative_path", classification: "file_truth", description: "Relative path from workspace root" },
    { field: "source_kind", classification: "file_truth", description: "Inferred from path prefix (wiki/ vs raw/)" },
    { field: "file_type", classification: "file_truth", description: "Derived from file extension" },
    { field: "file_size", classification: "file_truth", description: "From filesystem stat" },
    { field: "tags", classification: "file_truth", description: "From YAML frontmatter tags field" },
    { field: "date", classification: "file_truth", description: "From YAML frontmatter date field" },
    { field: "metadata", classification: "file_truth", description: "From YAML frontmatter (description, etc.)" },
    { field: "content_hash", classification: "file_truth", description: "SHA-256 of file bytes" },

    { field: "status", classification: "db_derived", description: "Tracking field, reset on reindex" },
    { field: "version", classification: "db_derived", description: "Incremented on updates" },
    { field: "parser", classification: "db_derived", description: "Records which parser was used" },
    { field: "stale_since", classification: "db_derived", description: "Staleness propagation tracking" },
    { field: "highlights", classification: "db_derived", description: "User highlights (UI-managed, not file-truth)" },
    { field: "page_count", classification: "db_derived", description: "Computed during parsing" },
    { field: "error_message", classification: "db_derived", description: "Error tracking during processing" },
    { field: "mtime_ns", classification: "db_derived", description: "Filesystem mtime cache for watcher efficiency" },
    { field: "last_indexed_at", classification: "db_derived", description: "Indexing timestamp" },
    { field: "document_number", classification: "db_derived", description: "Ordering field" },
    { field: "user_id", classification: "db_derived", description: "Always 'default' for single-user mode" },

    { field: "content (cached)", classification: "db_cached", description: "Content is cached in DB for search convenience; file prevails on divergence" },
    { field: "title (cached)", classification: "db_cached", description: "Title cached for query convenience; file prevails on divergence" },
    { field: "tags JSON (cached)", classification: "db_cached", description: "Tags serialized as JSON; frontmatter is truth source" },
  ];
}

export function isFileTruthField(field: string): boolean {
  return persistenceAudit().some(
    (audit) => audit.field === field && audit.classification === "file_truth",
  );
}

export function isDBDerivedField(field: string): boolean {
  return persistenceAudit().some(
    (audit) =>
      audit.field === field &&
      (audit.classification === "db_derived" || audit.classification === "db_cached"),
  );
}
