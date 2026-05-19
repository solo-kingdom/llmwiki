package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Document represents a row in the documents table.
type Document struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Filename       string    `json:"filename"`
	Title          string    `json:"title"`
	Path           string    `json:"path"`
	RelativePath   string    `json:"relative_path"`
	SourceKind     string    `json:"source_kind"`
	FileType       string    `json:"file_type"`
	FileSize       int64     `json:"file_size"`
	DocumentNumber int64     `json:"document_number"`
	Status         string    `json:"status"`
	PageCount      int64     `json:"page_count"`
	Content        string    `json:"content"`
	Tags           []string  `json:"tags"`
	Date           string    `json:"date"`
	Metadata       string    `json:"metadata"`
	ErrorMessage   string    `json:"error_message"`
	Version        int64     `json:"version"`
	Parser         string    `json:"parser"`
	ContentHash    string    `json:"content_hash"`
	StaleSince     string    `json:"stale_since"`
	Highlights     string    `json:"highlights"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
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
	return nil
}

// GetDocument retrieves a document by ID.
func (d *DB) GetDocument(id string) (*Document, error) {
	doc := &Document{}
	var tagsStr, highlightsStr sql.NullString
	err := d.db.QueryRow(`
		SELECT id, user_id, filename, title, path, relative_path, source_kind,
			file_type, file_size, document_number, status, page_count, content,
			tags, date, metadata, error_message, version, parser, content_hash,
			stale_since, highlights, created_at, updated_at
		FROM documents WHERE id = ? AND status != 'failed'`, id).
		Scan(&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
			&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
			&tagsStr, &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
			&doc.Parser, &doc.ContentHash, &doc.StaleSince, &highlightsStr,
			&doc.CreatedAt, &doc.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}

	if tagsStr.Valid {
		json.Unmarshal([]byte(tagsStr.String), &doc.Tags)
	}
	if highlightsStr.Valid {
		doc.Highlights = highlightsStr.String
	}
	return doc, nil
}

// FindDocumentByName finds a document by filename or title.
func (d *DB) FindDocumentByName(name string) (*Document, error) {
	doc := &Document{}
	var tagsStr, highlightsStr sql.NullString
	nameLower := name
	err := d.db.QueryRow(`
		SELECT id, user_id, filename, title, path, relative_path, source_kind,
			file_type, file_size, document_number, status, page_count, content,
			tags, date, metadata, error_message, version, parser, content_hash,
			stale_since, highlights, created_at, updated_at
		FROM documents WHERE (lower(filename) = ? OR lower(title) = ?) AND status != 'failed'
		LIMIT 1`, nameLower, nameLower).
		Scan(&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
			&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
			&tagsStr, &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
			&doc.Parser, &doc.ContentHash, &doc.StaleSince, &highlightsStr,
			&doc.CreatedAt, &doc.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find document: %w", err)
	}

	if tagsStr.Valid {
		json.Unmarshal([]byte(tagsStr.String), &doc.Tags)
	}
	if highlightsStr.Valid {
		doc.Highlights = highlightsStr.String
	}
	return doc, nil
}

// GetDocumentByPath finds a document by its relative_path.
func (d *DB) GetDocumentByPath(filename, dirPath string) (*Document, error) {
	doc := &Document{}
	var tagsStr, highlightsStr sql.NullString
	err := d.db.QueryRow(`
		SELECT id, user_id, filename, title, path, relative_path, source_kind,
			file_type, file_size, document_number, status, page_count, content,
			tags, date, metadata, error_message, version, parser, content_hash,
			stale_since, highlights, created_at, updated_at
		FROM documents WHERE filename = ? AND path = ? AND status != 'failed'`,
		filename, dirPath).
		Scan(&doc.ID, &doc.UserID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.RelativePath, &doc.SourceKind, &doc.FileType, &doc.FileSize,
			&doc.DocumentNumber, &doc.Status, &doc.PageCount, &doc.Content,
			&tagsStr, &doc.Date, &doc.Metadata, &doc.ErrorMessage, &doc.Version,
			&doc.Parser, &doc.ContentHash, &doc.StaleSince, &highlightsStr,
			&doc.CreatedAt, &doc.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get document by path: %w", err)
	}

	if tagsStr.Valid {
		json.Unmarshal([]byte(tagsStr.String), &doc.Tags)
	}
	if highlightsStr.Valid {
		doc.Highlights = highlightsStr.String
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

// ArchiveDocuments soft-deletes documents by ID.
func (d *DB) ArchiveDocuments(ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	// Use status='archived' for soft delete
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

// ListDocuments returns all non-failed documents.
func (d *DB) ListDocuments() ([]Document, error) {
	rows, err := d.db.Query(`
		SELECT id, filename, title, path, file_type, page_count, updated_at
		FROM documents WHERE status != 'failed' ORDER BY path, filename`)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()

	var docs []Document
	for rows.Next() {
		var doc Document
		if err := rows.Scan(&doc.ID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.FileType, &doc.PageCount, &doc.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan document: %w", err)
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

// ListDocumentsWithContent returns all non-failed documents with content.
func (d *DB) ListDocumentsWithContent() ([]Document, error) {
	rows, err := d.db.Query(`
		SELECT id, filename, title, path, content, file_type, page_count,
			status, source_kind, relative_path, tags, date, metadata,
			stale_since, highlights, version
		FROM documents WHERE status != 'failed' ORDER BY path, filename`)
	if err != nil {
		return nil, fmt.Errorf("list documents with content: %w", err)
	}
	defer rows.Close()

	var docs []Document
	for rows.Next() {
		var doc Document
		var tagsStr, highlightsStr sql.NullString
		if err := rows.Scan(&doc.ID, &doc.Filename, &doc.Title, &doc.Path,
			&doc.Content, &doc.FileType, &doc.PageCount, &doc.Status,
			&doc.SourceKind, &doc.RelativePath, &tagsStr, &doc.Date,
			&doc.Metadata, &doc.StaleSince, &highlightsStr, &doc.Version); err != nil {
			return nil, fmt.Errorf("scan document content: %w", err)
		}
		if tagsStr.Valid {
			json.Unmarshal([]byte(tagsStr.String), &doc.Tags)
		}
		if highlightsStr.Valid {
			doc.Highlights = highlightsStr.String
		}
		docs = append(docs, doc)
	}
	return docs, nil
}
