package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// documentSelect returns the SELECT column list with COALESCE for nullable fields.
const documentSelect = `
	COALESCE(d.id, ''), COALESCE(d.user_id, ''), COALESCE(d.filename, ''),
	COALESCE(d.title, ''), COALESCE(d.path, ''), COALESCE(d.relative_path, ''),
	COALESCE(d.source_kind, ''), COALESCE(d.file_type, ''), COALESCE(d.file_size, 0),
	COALESCE(d.document_number, 0), COALESCE(d.status, ''), COALESCE(d.page_count, 0),
	COALESCE(d.content, ''), COALESCE(d.tags, '[]'), COALESCE(d.date, ''),
	COALESCE(d.metadata, ''), COALESCE(d.error_message, ''), COALESCE(d.version, 0),
	COALESCE(d.parser, ''), COALESCE(d.content_hash, ''), COALESCE(d.stale_since, ''),
	COALESCE(d.highlights, '[]'), COALESCE(d.created_at, ''), COALESCE(d.updated_at, ''),
	COALESCE(d.deleted_at, '')`

// scanDocumentRow scans one documentSelect row. A missing row yields (nil, nil).
func scanDocumentRow(row pgx.Row) (*store.Document, error) {
	doc := &store.Document{}
	var tagsStr string
	err := row.Scan(
		&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
		&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
		&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
		&tagsStr, &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
		&doc.Parser, &doc.ContentHash, &doc.StaleSince, &doc.Highlights,
		&doc.CreatedAt, &doc.UpdatedAt, &doc.DeletedAt,
	)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if tagsStr != "" && tagsStr != "[]" {
		_ = json.Unmarshal([]byte(tagsStr), &doc.Tags)
	}
	return doc, nil
}

// CreateDocument inserts a document, assigning an ID when absent and the next
// document number.
func (d *DB) CreateDocument(doc *store.Document) error {
	ctx := context.Background()
	id := uuid.NewString()
	if doc.ID != "" {
		id = doc.ID
	}

	tagsJSON := "[]"
	if len(doc.Tags) > 0 {
		b, _ := json.Marshal(doc.Tags)
		tagsJSON = string(b)
	}

	var docNum int64
	if err := d.pool.QueryRow(ctx,
		"SELECT COALESCE(MAX(document_number), 0) + 1 FROM documents").Scan(&docNum); err != nil {
		docNum = 1
	}

	_, err := d.pool.Exec(ctx, `
		INSERT INTO documents (
			id, user_id, filename, title, path, relative_path, source_kind,
			file_type, file_size, document_number, status, content, tags, date,
			metadata, version, parser, content_hash, highlights
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
		id, doc.UserID, doc.Filename, doc.Title, doc.Path, doc.RelativePath, doc.SourceKind,
		doc.FileType, doc.FileSize, docNum, doc.Status, doc.Content, tagsJSON, doc.Date,
		doc.Metadata, doc.Version, doc.Parser, doc.ContentHash, doc.Highlights,
	)
	if err != nil {
		return fmt.Errorf("create document: %w", err)
	}

	doc.ID = id
	doc.DocumentNumber = docNum
	return nil
}

// GetDocument retrieves a document by ID. Soft-deleted documents are returned
// on purpose: rollback and history need the row after archival.
func (d *DB) GetDocument(id string) (*store.Document, error) {
	doc, err := scanDocumentRow(d.pool.QueryRow(context.Background(),
		"SELECT "+documentSelect+" FROM documents d WHERE d.id = $1 AND d.status != 'failed'", id))
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}
	return doc, nil
}

// GetWikiDocumentByID returns a wiki document by id or nil if missing/not wiki.
func (d *DB) GetWikiDocumentByID(id string) (*store.Document, error) {
	doc, err := d.GetDocument(id)
	if err != nil {
		return nil, err
	}
	if doc == nil || doc.SourceKind != "wiki" || doc.Status == "failed" {
		return nil, nil
	}
	return doc, nil
}

// FindDocumentByName finds a document by filename or title.
func (d *DB) FindDocumentByName(name string) (*store.Document, error) {
	doc, err := scanDocumentRow(d.pool.QueryRow(context.Background(),
		"SELECT "+documentSelect+` FROM documents d
		WHERE (lower(d.filename) = lower($1) OR lower(d.title) = lower($1))
		  AND d.status != 'failed' AND d.deleted_at IS NULL
		LIMIT 1`, name))
	if err != nil {
		return nil, fmt.Errorf("find document: %w", err)
	}
	return doc, nil
}

// GetDocumentByPath finds a document by its filename and directory path.
func (d *DB) GetDocumentByPath(filename, dirPath string) (*store.Document, error) {
	doc, err := scanDocumentRow(d.pool.QueryRow(context.Background(),
		"SELECT "+documentSelect+` FROM documents d
		WHERE d.filename = $1 AND d.path = $2 AND d.status != 'failed' AND d.deleted_at IS NULL
		LIMIT 1`, filename, dirPath))
	if err != nil {
		return nil, fmt.Errorf("get document by path: %w", err)
	}
	return doc, nil
}

// UpdateDocument updates content and metadata and bumps the version.
func (d *DB) UpdateDocument(id, content, title string, tags []string, date, metadata string) error {
	tagsJSON := "[]"
	if len(tags) > 0 {
		b, _ := json.Marshal(tags)
		tagsJSON = string(b)
	}

	_, err := d.pool.Exec(context.Background(), `
		UPDATE documents SET
			content = $1,
			title = COALESCE(NULLIF($2, ''), title),
			tags = $3,
			date = COALESCE(NULLIF($4, ''), date),
			metadata = COALESCE(NULLIF($5, ''), metadata),
			version = COALESCE(version, 0) + 1,
			updated_at = `+nowText+`
		WHERE id = $6`,
		content, title, tagsJSON, date, metadata, id)
	if err != nil {
		return fmt.Errorf("update document: %w", err)
	}
	return nil
}

// ArchiveDocuments soft-deletes documents and clears their chunks and
// references. Rows already archived are left untouched and not counted.
func (d *DB) ArchiveDocuments(ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	ctx := context.Background()
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("archive documents: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE documents SET deleted_at = `+nowText+`
		WHERE id = ANY($1::text[]) AND deleted_at IS NULL`, ids)
	if err != nil {
		return 0, fmt.Errorf("archive documents: %w", err)
	}
	if _, err := tx.Exec(ctx,
		"DELETE FROM document_chunks WHERE document_id = ANY($1::text[])", ids); err != nil {
		return 0, fmt.Errorf("archive documents: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM document_references
		WHERE source_document_id = ANY($1::text[]) OR target_document_id = ANY($1::text[])`, ids); err != nil {
		return 0, fmt.Errorf("archive documents: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("archive documents: %w", err)
	}
	return tag.RowsAffected(), nil
}

// ListDocuments returns all non-failed, non-deleted documents.
func (d *DB) ListDocuments() ([]store.Document, error) {
	return d.ListDocumentsFiltered(store.ListDocumentsFilter{})
}

// ListDocumentsFiltered returns documents matching optional filters.
func (d *DB) ListDocumentsFiltered(f store.ListDocumentsFilter) ([]store.Document, error) {
	sqlStr := `
		SELECT id, filename, title, path, file_type, COALESCE(page_count, 0), COALESCE(updated_at, ''),
			COALESCE(relative_path, ''), COALESCE(source_kind, '')
		FROM documents WHERE status != 'failed' AND deleted_at IS NULL `
	var args []any
	if f.SourceKind != "" {
		args = append(args, f.SourceKind)
		sqlStr += fmt.Sprintf("AND source_kind = $%d ", len(args))
	}
	if f.ExcludeHidden {
		sqlStr += "AND NOT (" + hiddenSubdirsWhere("relative_path") + ") "
	}
	sqlStr += "ORDER BY path, filename"

	rows, err := d.pool.Query(context.Background(), sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()

	var docs []store.Document
	for rows.Next() {
		var doc store.Document
		if err := rows.Scan(&doc.ID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.FileType, &doc.PageCount, &doc.UpdatedAt, &doc.RelativePath, &doc.SourceKind); err != nil {
			return nil, fmt.Errorf("scan document: %w", err)
		}
		doc.PageType = engine.WikiPageTypeFromPaths(doc.RelativePath, doc.Path)
		if len(f.PageTypes) > 0 && !documentMatchesPageType(doc, f.PageTypes) {
			continue
		}
		docs = append(docs, doc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan document: %w", err)
	}
	return docs, nil
}

func documentMatchesPageType(doc store.Document, types []string) bool {
	pt := engine.WikiPageTypeFromPaths(doc.RelativePath, doc.Path)
	for _, want := range types {
		if pt == want {
			return true
		}
	}
	return false
}

// hiddenSubdirsWhere returns a SQL WHERE fragment matching documents under any
// wiki hidden subdirectory. col is "relative_path" or "d.relative_path".
func hiddenSubdirsWhere(col string) string {
	var parts []string
	for subdir := range engine.WikiHiddenSubdirs {
		parts = append(parts, fmt.Sprintf("%s LIKE 'wiki/%s/%%'", col, subdir))
	}
	return strings.Join(parts, " OR ")
}

// ListDocumentsWithContent returns all non-failed, non-deleted documents with content.
func (d *DB) ListDocumentsWithContent() ([]store.Document, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT id, filename, title, path, content, file_type,
			COALESCE(page_count, 0), COALESCE(status, ''), COALESCE(source_kind, ''),
			COALESCE(relative_path, ''), COALESCE(tags, '[]'), COALESCE(date, ''),
			COALESCE(metadata, ''), COALESCE(stale_since, ''), COALESCE(highlights, '[]'),
			COALESCE(version, 0)
		FROM documents WHERE status != 'failed' AND deleted_at IS NULL ORDER BY path, filename`)
	if err != nil {
		return nil, fmt.Errorf("list documents with content: %w", err)
	}
	defer rows.Close()

	var docs []store.Document
	for rows.Next() {
		var doc store.Document
		var tagsStr string
		if err := rows.Scan(&doc.ID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.Content, &doc.FileType, &doc.PageCount, &doc.Status,
			&doc.SourceKind, &doc.RelativePath, &tagsStr, &doc.Date,
			&doc.Metadata, &doc.StaleSince, &doc.Highlights, &doc.Version); err != nil {
			return nil, fmt.Errorf("scan document content: %w", err)
		}
		if tagsStr != "" && tagsStr != "[]" {
			_ = json.Unmarshal([]byte(tagsStr), &doc.Tags)
		}
		docs = append(docs, doc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan document content: %w", err)
	}
	return docs, nil
}

var (
	_ store.DocumentStore = (*DB)(nil)
	_ store.IndexStore    = (*DB)(nil)
)
