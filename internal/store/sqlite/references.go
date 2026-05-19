package sqlite

import (
	"database/sql"
	"fmt"
)

// Reference represents an edge in the citation/link graph.
type Reference struct {
	SourceDocumentID string `json:"source_document_id"`
	TargetDocumentID string `json:"target_document_id"`
	ReferenceType    string `json:"reference_type"` // "cites" or "links_to"
	Page             int    `json:"page"`
}

// ReferenceSummary is used for backlink/forward reference display.
type ReferenceSummary struct {
	Path          string `json:"path"`
	Filename      string `json:"filename"`
	Title         string `json:"title"`
	ReferenceType string `json:"reference_type"`
	Page          int    `json:"page"`
}

// StalePage represents a page marked as stale.
type StalePage struct {
	Filename   string `json:"filename"`
	Title      string `json:"title"`
	Path       string `json:"path"`
	StaleSince string `json:"stale_since"`
}

// UncitedSource represents a source document with no wiki citations.
type UncitedSource struct {
	Filename string `json:"filename"`
	Title    string `json:"title"`
	Path     string `json:"path"`
	FileType string `json:"file_type"`
}

// DeleteReferences removes all references originating from the given document.
func (d *DB) DeleteReferences(sourceDocID string) error {
	_, err := d.db.Exec("DELETE FROM document_references WHERE source_document_id = ?", sourceDocID)
	return err
}

// UpsertReference inserts or replaces a reference edge.
func (d *DB) UpsertReference(sourceID, targetID, refType string, page *int) error {
	_, err := d.db.Exec(`
		INSERT OR REPLACE INTO document_references
		(source_document_id, target_document_id, reference_type, page)
		VALUES (?, ?, ?, ?)`,
		sourceID, targetID, refType, page)
	if err != nil {
		return fmt.Errorf("upsert reference: %w", err)
	}
	return nil
}

// GetBacklinks returns all documents that reference the given document.
func (d *DB) GetBacklinks(docID string) ([]ReferenceSummary, error) {
	rows, err := d.db.Query(`
		SELECT d.path, d.filename, d.title, dr.reference_type
		FROM document_references dr
		JOIN documents d ON dr.source_document_id = d.id
		WHERE dr.target_document_id = ? AND d.status != 'failed'
		ORDER BY d.path, d.filename`, docID)
	if err != nil {
		return nil, fmt.Errorf("get backlinks: %w", err)
	}
	defer rows.Close()

	var refs []ReferenceSummary
	for rows.Next() {
		var r ReferenceSummary
		if err := rows.Scan(&r.Path, &r.Filename, &r.Title, &r.ReferenceType); err != nil {
			return nil, fmt.Errorf("scan backlink: %w", err)
		}
		refs = append(refs, r)
	}
	return refs, nil
}

// GetForwardReferences returns all documents that the given document references.
func (d *DB) GetForwardReferences(docID string) ([]ReferenceSummary, error) {
	rows, err := d.db.Query(`
		SELECT d.filename, d.title, d.path, dr.reference_type, dr.page
		FROM document_references dr
		JOIN documents d ON dr.target_document_id = d.id
		WHERE dr.source_document_id = ? AND d.status != 'failed'
		ORDER BY dr.reference_type, d.path, d.filename`, docID)
	if err != nil {
		return nil, fmt.Errorf("get forward references: %w", err)
	}
	defer rows.Close()

	var refs []ReferenceSummary
	for rows.Next() {
		var r ReferenceSummary
		var page sql.NullInt64
		if err := rows.Scan(&r.Filename, &r.Title, &r.Path, &r.ReferenceType, &page); err != nil {
			return nil, fmt.Errorf("scan forward ref: %w", err)
		}
		if page.Valid {
			r.Page = int(page.Int64)
		}
		refs = append(refs, r)
	}
	return refs, nil
}

// FindUncitedSources returns source documents with no wiki citations.
func (d *DB) FindUncitedSources() ([]UncitedSource, error) {
	rows, err := d.db.Query(`
		SELECT d.filename, d.title, d.path, d.file_type
		FROM documents d
		WHERE d.source_kind != 'wiki' AND d.status != 'failed'
		  AND d.id NOT IN (
			SELECT target_document_id FROM document_references WHERE reference_type = 'cites'
		  )
		ORDER BY d.filename`)
	if err != nil {
		return nil, fmt.Errorf("find uncited: %w", err)
	}
	defer rows.Close()

	var sources []UncitedSource
	for rows.Next() {
		var s UncitedSource
		if err := rows.Scan(&s.Filename, &s.Title, &s.Path, &s.FileType); err != nil {
			return nil, fmt.Errorf("scan uncited: %w", err)
		}
		sources = append(sources, s)
	}
	return sources, nil
}

// FindStalePages returns wiki pages marked as stale.
func (d *DB) FindStalePages() ([]StalePage, error) {
	rows, err := d.db.Query(`
		SELECT d.filename, d.title, d.path, d.stale_since
		FROM documents d
		WHERE d.status != 'failed' AND d.stale_since IS NOT NULL
		ORDER BY d.stale_since DESC`)
	if err != nil {
		return nil, fmt.Errorf("find stale: %w", err)
	}
	defer rows.Close()

	var pages []StalePage
	for rows.Next() {
		var p StalePage
		if err := rows.Scan(&p.Filename, &p.Title, &p.Path, &p.StaleSince); err != nil {
			return nil, fmt.Errorf("scan stale: %w", err)
		}
		pages = append(pages, p)
	}
	return pages, nil
}

// PropagateStaleness marks all pages that link to the given page as stale.
func (d *DB) PropagateStaleness(docID string) error {
	_, err := d.db.Exec(`
		UPDATE documents SET stale_since = datetime('now')
		WHERE id IN (
			SELECT source_document_id FROM document_references
			WHERE target_document_id = ? AND reference_type = 'links_to'
		) AND stale_since IS NULL`, docID)
	return err
}
