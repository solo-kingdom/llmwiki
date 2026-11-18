package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// DeleteReferences removes all references originating from the given document.
func (d *DB) DeleteReferences(sourceDocID string) error {
	_, err := d.pool.Exec(context.Background(),
		"DELETE FROM document_references WHERE source_document_id = $1", sourceDocID)
	return err
}

// UpsertReference inserts or replaces a reference edge.
func (d *DB) UpsertReference(sourceID, targetID, refType string, page *int) error {
	_, err := d.pool.Exec(context.Background(), `
		INSERT INTO document_references (id, source_document_id, target_document_id, reference_type, page)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (source_document_id, target_document_id, reference_type)
		DO UPDATE SET page = EXCLUDED.page`,
		uuid.NewString(), sourceID, targetID, refType, page)
	if err != nil {
		return fmt.Errorf("upsert reference: %w", err)
	}
	return nil
}

// GetBacklinks returns all documents that reference the given document.
func (d *DB) GetBacklinks(docID string) ([]store.ReferenceSummary, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT d.path, d.filename, d.title, dr.reference_type
		FROM document_references dr
		JOIN documents d ON dr.source_document_id = d.id
		WHERE dr.target_document_id = $1 AND d.status != 'failed' AND d.deleted_at IS NULL
		ORDER BY d.path, d.filename`, docID)
	if err != nil {
		return nil, fmt.Errorf("get backlinks: %w", err)
	}
	defer rows.Close()

	var refs []store.ReferenceSummary
	for rows.Next() {
		var r store.ReferenceSummary
		if err := rows.Scan(&r.Path, &r.Filename, &r.Title, &r.ReferenceType); err != nil {
			return nil, fmt.Errorf("scan backlink: %w", err)
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan backlink: %w", err)
	}
	return refs, nil
}

// GetForwardReferences returns all documents that the given document references.
func (d *DB) GetForwardReferences(docID string) ([]store.ReferenceSummary, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT d.filename, d.title, d.path, dr.reference_type, dr.page
		FROM document_references dr
		JOIN documents d ON dr.target_document_id = d.id
		WHERE dr.source_document_id = $1 AND d.status != 'failed' AND d.deleted_at IS NULL
		ORDER BY dr.reference_type, d.path, d.filename`, docID)
	if err != nil {
		return nil, fmt.Errorf("get forward references: %w", err)
	}
	defer rows.Close()

	var refs []store.ReferenceSummary
	for rows.Next() {
		var r store.ReferenceSummary
		var page sql.NullInt64
		if err := rows.Scan(&r.Filename, &r.Title, &r.Path, &r.ReferenceType, &page); err != nil {
			return nil, fmt.Errorf("scan forward ref: %w", err)
		}
		if page.Valid {
			r.Page = int(page.Int64)
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan forward ref: %w", err)
	}
	return refs, nil
}

// FindUncitedSources returns source documents with no wiki citations.
func (d *DB) FindUncitedSources() ([]store.UncitedSource, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT d.filename, d.title, d.path, d.file_type
		FROM documents d
		WHERE d.source_kind != 'wiki' AND d.status != 'failed' AND d.deleted_at IS NULL
		  AND NOT EXISTS (
			SELECT 1 FROM document_references dr
			WHERE dr.target_document_id = d.id AND dr.reference_type = 'cites'
		  )
		ORDER BY d.filename`)
	if err != nil {
		return nil, fmt.Errorf("find uncited: %w", err)
	}
	defer rows.Close()

	var sources []store.UncitedSource
	for rows.Next() {
		var s store.UncitedSource
		if err := rows.Scan(&s.Filename, &s.Title, &s.Path, &s.FileType); err != nil {
			return nil, fmt.Errorf("scan uncited: %w", err)
		}
		sources = append(sources, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan uncited: %w", err)
	}
	return sources, nil
}

// FindStalePages returns wiki pages marked as stale.
func (d *DB) FindStalePages() ([]store.StalePage, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT d.filename, d.title, d.path, d.stale_since
		FROM documents d
		WHERE d.status != 'failed' AND d.deleted_at IS NULL AND d.stale_since IS NOT NULL
		ORDER BY d.stale_since DESC`)
	if err != nil {
		return nil, fmt.Errorf("find stale: %w", err)
	}
	defer rows.Close()

	var pages []store.StalePage
	for rows.Next() {
		var p store.StalePage
		if err := rows.Scan(&p.Filename, &p.Title, &p.Path, &p.StaleSince); err != nil {
			return nil, fmt.Errorf("scan stale: %w", err)
		}
		pages = append(pages, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan stale: %w", err)
	}
	return pages, nil
}

// PropagateStaleness marks all pages that link to the given page as stale.
func (d *DB) PropagateStaleness(docID string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE documents SET stale_since = `+nowText+`
		WHERE id IN (
			SELECT source_document_id FROM document_references
			WHERE target_document_id = $1 AND reference_type = 'links_to'
		) AND stale_since IS NULL AND deleted_at IS NULL`, docID)
	return err
}

// ReplaceReferencesInTx atomically replaces all references for a source document.
func (d *DB) ReplaceReferencesInTx(sourceDocID string, edges []store.RefEdge) error {
	ctx := context.Background()
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		"DELETE FROM document_references WHERE source_document_id = $1", sourceDocID); err != nil {
		return fmt.Errorf("delete old refs: %w", err)
	}
	for _, e := range edges {
		_, err := tx.Exec(ctx, `
			INSERT INTO document_references (id, source_document_id, target_document_id, reference_type, page)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (source_document_id, target_document_id, reference_type)
			DO UPDATE SET page = EXCLUDED.page`,
			uuid.NewString(), e.SourceID, e.TargetID, e.RefType, e.Page)
		if err != nil {
			return fmt.Errorf("insert ref (%s → %s, %s): %w", e.SourceID, e.TargetID, e.RefType, err)
		}
	}
	return tx.Commit(ctx)
}
