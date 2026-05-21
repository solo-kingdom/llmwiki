package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/solo-kingdom/llmwiki/internal/engine"
)

// Document represents a row in the documents table.
type Document struct {
	ID             string   `json:"id"`
	UserID         string   `json:"user_id"`
	Filename       string   `json:"filename"`
	Title          string   `json:"title"`
	Path           string   `json:"path"`
	RelativePath   string   `json:"relative_path"`
	SourceKind     string   `json:"source_kind"`
	FileType       string   `json:"file_type"`
	FileSize       int64    `json:"file_size"`
	DocumentNumber int64    `json:"document_number"`
	Status         string   `json:"status"`
	PageCount      int64    `json:"page_count"`
	Content        string   `json:"content"`
	Tags           []string `json:"tags"`
	Date           string   `json:"date"`
	Metadata       string   `json:"metadata"`
	ErrorMessage   string   `json:"error_message"`
	Version        int64    `json:"version"`
	Parser         string   `json:"parser"`
	ContentHash    string   `json:"content_hash"`
	StaleSince     string   `json:"stale_since"`
	Highlights     string   `json:"highlights"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	PageType       string   `json:"page_type,omitempty"`
}

// docSelect returns the SELECT column list with COALESCE for nullable fields.
const docSelect = `
	COALESCE(d.id, ''), COALESCE(d.user_id, ''), COALESCE(d.filename, ''),
	COALESCE(d.title, ''), COALESCE(d.path, ''), COALESCE(d.relative_path, ''),
	COALESCE(d.source_kind, ''), COALESCE(d.file_type, ''), COALESCE(d.file_size, 0),
	COALESCE(d.document_number, 0), COALESCE(d.status, ''), COALESCE(d.page_count, 0),
	COALESCE(d.content, ''), COALESCE(d.tags, '[]'), COALESCE(d.date, ''),
	COALESCE(d.metadata, ''), COALESCE(d.error_message, ''), COALESCE(d.version, 0),
	COALESCE(d.parser, ''), COALESCE(d.content_hash, ''), COALESCE(d.stale_since, ''),
	COALESCE(d.highlights, '[]'), COALESCE(d.created_at, ''), COALESCE(d.updated_at, '')`

// scanFullDoc scans all document columns into a Document, parsing tags from JSON.
func scanFullDoc(scanner interface{ Scan(...interface{}) error }, doc *Document) error {
	var tagsStr string
	err := scanner.Scan(
		&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
		&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
		&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
		&tagsStr, &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
		&doc.Parser, &doc.ContentHash, &doc.StaleSince, &doc.Highlights,
		&doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if tagsStr != "" && tagsStr != "[]" {
		json.Unmarshal([]byte(tagsStr), &doc.Tags)
	}
	return nil
}

// CreateDocument inserts a new document.
func (d *DB) CreateDocument(doc *Document) error {
	id := uuid.New().String()
	if doc.ID != "" {
		id = doc.ID
	}

	tagsJSON := "[]"
	if len(doc.Tags) > 0 {
		b, _ := json.Marshal(doc.Tags)
		tagsJSON = string(b)
	}

	// Get next document number
	var docNum int64
	err := d.db.QueryRow("SELECT COALESCE(MAX(document_number), 0) + 1 FROM documents").Scan(&docNum)
	if err != nil {
		docNum = 1
	}

	_, err = d.db.Exec(`
		INSERT INTO documents (
			id, user_id, filename, title, path, relative_path, source_kind,
			file_type, file_size, document_number, status, content, tags, date,
			metadata, version, parser, content_hash, highlights
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
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

// GetDocument retrieves a document by ID.
func (d *DB) GetDocument(id string) (*Document, error) {
	doc := &Document{}
	err := d.db.QueryRow(
		"SELECT "+docSelect+" FROM documents d WHERE d.id = ? AND d.status != 'failed'", id,
	).Scan(
		&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
		&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
		&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
		new(string), &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
		&doc.Parser, &doc.ContentHash, &doc.StaleSince, &doc.Highlights,
		&doc.CreatedAt, &doc.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}
	// Parse tags from a separate fetch
	var tagsStr string
	_ = d.db.QueryRow("SELECT COALESCE(tags,'[]') FROM documents WHERE id = ?", id).Scan(&tagsStr)
	if tagsStr != "" && tagsStr != "[]" {
		json.Unmarshal([]byte(tagsStr), &doc.Tags)
	}
	return doc, nil
}

// FindDocumentByName finds a document by filename or title.
func (d *DB) FindDocumentByName(name string) (*Document, error) {
	doc := &Document{}
	err := d.db.QueryRow(
		"SELECT "+docSelect+" FROM documents d WHERE (lower(d.filename) = ? OR lower(d.title) = ?) AND d.status != 'failed' LIMIT 1",
		name, name,
	).Scan(
		&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
		&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
		&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
		new(string), &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
		&doc.Parser, &doc.ContentHash, &doc.StaleSince, &doc.Highlights,
		&doc.CreatedAt, &doc.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find document: %w", err)
	}
	var tagsStr string
	_ = d.db.QueryRow("SELECT COALESCE(tags,'[]') FROM documents WHERE id = ?", doc.ID).Scan(&tagsStr)
	if tagsStr != "" && tagsStr != "[]" {
		json.Unmarshal([]byte(tagsStr), &doc.Tags)
	}
	return doc, nil
}

// GetDocumentByPath finds a document by its filename and directory path.
func (d *DB) GetDocumentByPath(filename, dirPath string) (*Document, error) {
	doc := &Document{}
	err := d.db.QueryRow(
		"SELECT "+docSelect+" FROM documents d WHERE d.filename = ? AND d.path = ? AND d.status != 'failed'",
		filename, dirPath,
	).Scan(
		&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
		&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
		&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
		new(string), &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
		&doc.Parser, &doc.ContentHash, &doc.StaleSince, &doc.Highlights,
		&doc.CreatedAt, &doc.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get document by path: %w", err)
	}
	var tagsStr string
	_ = d.db.QueryRow("SELECT COALESCE(tags,'[]') FROM documents WHERE id = ?", doc.ID).Scan(&tagsStr)
	if tagsStr != "" && tagsStr != "[]" {
		json.Unmarshal([]byte(tagsStr), &doc.Tags)
	}
	return doc, nil
}

// UpdateDocument updates an existing document's content and metadata.
func (d *DB) UpdateDocument(id, content, title string, tags []string, date, metadata string) error {
	tagsJSON := "[]"
	if len(tags) > 0 {
		b, _ := json.Marshal(tags)
		tagsJSON = string(b)
	}

	_, err := d.db.Exec(`
		UPDATE documents SET
			content = ?,
			title = COALESCE(NULLIF(?, ''), title),
			tags = ?,
			date = COALESCE(NULLIF(?, ''), date),
			metadata = COALESCE(NULLIF(?, ''), metadata),
			version = COALESCE(version, 0) + 1,
			updated_at = datetime('now')
		WHERE id = ?`,
		content, title, tagsJSON, date, metadata, id)
	if err != nil {
		return fmt.Errorf("update document: %w", err)
	}
	return nil
}

// ArchiveDocuments deletes documents by ID.
func (d *DB) ArchiveDocuments(ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	placeholders := make([]byte, 0, len(ids)*2-1)
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		if i > 0 {
			placeholders = append(placeholders, ',')
		}
		placeholders = append(placeholders, '?')
		args[i] = id
	}

	result, err := d.db.Exec(
		"DELETE FROM documents WHERE id IN ("+string(placeholders)+")",
		args...,
	)
	if err != nil {
		return 0, fmt.Errorf("archive documents: %w", err)
	}
	return result.RowsAffected()
}

// ListDocumentsFilter optionally restricts listed documents.
type ListDocumentsFilter struct {
	SourceKind string
	PageTypes  []string
}

// ListDocuments returns all non-failed documents.
func (d *DB) ListDocuments() ([]Document, error) {
	return d.ListDocumentsFiltered(ListDocumentsFilter{})
}

// ListDocumentsFiltered returns documents matching optional source_kind and page type filters.
func (d *DB) ListDocumentsFiltered(f ListDocumentsFilter) ([]Document, error) {
	sqlStr := `
		SELECT id, filename, title, path, file_type, COALESCE(page_count, 0), COALESCE(updated_at, ''),
			COALESCE(relative_path, ''), COALESCE(source_kind, '')
		FROM documents WHERE status != 'failed' `
	var args []interface{}
	if f.SourceKind != "" {
		sqlStr += "AND source_kind = ? "
		args = append(args, f.SourceKind)
	}
	sqlStr += "ORDER BY path, filename"

	rows, err := d.db.Query(sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()

	var docs []Document
	for rows.Next() {
		var doc Document
		if err := rows.Scan(&doc.ID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.FileType, &doc.PageCount, &doc.UpdatedAt, &doc.RelativePath, &doc.SourceKind); err != nil {
			return nil, fmt.Errorf("scan document: %w", err)
		}
		doc.PageType = PageTypeForDocument(doc)
		if len(f.PageTypes) > 0 && !matchPageType(doc, f.PageTypes) {
			continue
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

func matchPageType(doc Document, types []string) bool {
	pt := engine.WikiPageTypeFromPaths(doc.RelativePath, doc.Path)
	for _, want := range types {
		if pt == want {
			return true
		}
	}
	return false
}

// PageTypeForDocument returns the wiki page type for a document row.
func PageTypeForDocument(doc Document) string {
	return engine.WikiPageTypeFromPaths(doc.RelativePath, doc.Path)
}

// ListDocumentsWithContent returns all non-failed documents with content.
func (d *DB) ListDocumentsWithContent() ([]Document, error) {
	rows, err := d.db.Query(`
		SELECT id, filename, title, path, content, file_type,
			COALESCE(page_count, 0), COALESCE(status, ''), COALESCE(source_kind, ''),
			COALESCE(relative_path, ''), COALESCE(tags, '[]'), COALESCE(date, ''),
			COALESCE(metadata, ''), COALESCE(stale_since, ''), COALESCE(highlights, '[]'),
			COALESCE(version, 0)
		FROM documents WHERE status != 'failed' ORDER BY path, filename`)
	if err != nil {
		return nil, fmt.Errorf("list documents with content: %w", err)
	}
	defer rows.Close()

	var docs []Document
	for rows.Next() {
		var doc Document
		var tagsStr string
		if err := rows.Scan(&doc.ID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.Content, &doc.FileType, &doc.PageCount, &doc.Status,
			&doc.SourceKind, &doc.RelativePath, &tagsStr, &doc.Date,
			&doc.Metadata, &doc.StaleSince, &doc.Highlights, &doc.Version); err != nil {
			return nil, fmt.Errorf("scan document content: %w", err)
		}
		if tagsStr != "" && tagsStr != "[]" {
			json.Unmarshal([]byte(tagsStr), &doc.Tags)
		}
		docs = append(docs, doc)
	}
	return docs, nil
}
