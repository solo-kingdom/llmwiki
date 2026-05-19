package engine

// DataClassification identifies whether a field is file-truth or DB-derived.
type DataClassification int

const (
	FileTruth   DataClassification = iota // Canonical data from filesystem
	DBDerived                             // Rebuildable from file truth
	DBCached                              // Performance mirror of file truth (non-authoritative)
)

// FieldAudit describes the classification of a single document field.
type FieldAudit struct {
	Field         string
	Classification DataClassification
	Description   string
}

// PersistenceAudit returns the full classification of document persistence fields.
// This implements the "audit persistence paths and classify fields" requirement
// from the truth-data-persistence-boundary capability.
func PersistenceAudit() []FieldAudit {
	return []FieldAudit{
		// File-truth fields (canonical source)
		{"content", FileTruth, "Markdown file content — canonical source of truth"},
		{"filename", FileTruth, "Derived from file path on disk"},
		{"title", FileTruth, "From YAML frontmatter or filename-derived"},
		{"path", FileTruth, "Directory path on disk"},
		{"relative_path", FileTruth, "Relative path from workspace root"},
		{"source_kind", FileTruth, "Inferred from path prefix (wiki/ vs raw/)"},
		{"file_type", FileTruth, "Derived from file extension"},
		{"file_size", FileTruth, "From filesystem stat"},
		{"tags", FileTruth, "From YAML frontmatter tags field"},
		{"date", FileTruth, "From YAML frontmatter date field"},
		{"metadata", FileTruth, "From YAML frontmatter (description, etc.)"},
		{"content_hash", FileTruth, "SHA-256 of file bytes"},

		// DB-derived fields (fully rebuildable)
		{"status", DBDerived, "Tracking field, reset on reindex"},
		{"version", DBDerived, "Incremented on updates"},
		{"parser", DBDerived, "Records which parser was used"},
		{"stale_since", DBDerived, "Staleness propagation tracking"},
		{"highlights", DBDerived, "User highlights (UI-managed, not file-truth)"},
		{"page_count", DBDerived, "Computed during parsing"},
		{"error_message", DBDerived, "Error tracking during processing"},
		{"mtime_ns", DBDerived, "Filesystem mtime cache for watcher efficiency"},
		{"last_indexed_at", DBDerived, "Indexing timestamp"},
		{"document_number", DBDerived, "Ordering field"},
		{"user_id", DBDerived, "Always 'default' for single-user mode"},

		// DB-cached (performance mirror, non-authoritative)
		{"content (cached)", DBCached, "Content is cached in DB for search convenience; file prevails on divergence"},
		{"title (cached)", DBCached, "Title cached for query convenience; file prevails on divergence"},
		{"tags JSON (cached)", DBCached, "Tags serialized as JSON; frontmatter is truth source"},
	}

}

// IsFileTruthField returns whether a given field is classified as file-truth.
func IsFileTruthField(field string) bool {
	for _, audit := range PersistenceAudit() {
		if audit.Field == field {
			return audit.Classification == FileTruth
		}
	}
	return false
}

// IsDBDerivedField returns whether a given field is classified as DB-derived or DB-cached.
func IsDBDerivedField(field string) bool {
	for _, audit := range PersistenceAudit() {
		if audit.Field == field {
			return audit.Classification == DBDerived || audit.Classification == DBCached
		}
	}
	return false
}
