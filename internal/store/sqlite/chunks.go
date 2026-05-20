package sqlite

import (
	"database/sql"
	"fmt"
	"unicode"

	"github.com/google/uuid"
)

// Chunk represents a text chunk for FTS5 indexing.
type Chunk struct {
	DocumentID      string
	ChunkIndex      int
	Content         string
	Page            int
	StartChar       int
	TokenCount      int
	HeaderBreadcrumb string
}

// StoreChunks replaces all chunks for a document with the given chunks.
func (d *DB) StoreChunks(docID string, chunks []Chunk) error {
	// Delete existing chunks (CASCADE deletes from chunks_fts via trigger)
	if _, err := d.db.Exec("DELETE FROM document_chunks WHERE document_id = ?", docID); err != nil {
		return fmt.Errorf("delete chunks: %w", err)
	}

	// Insert new chunks
	for _, c := range chunks {
		id := uuid.New().String()
		_, err := d.db.Exec(`
			INSERT INTO document_chunks (id, document_id, chunk_index, content, page, start_char, token_count, header_breadcrumb)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, docID, c.ChunkIndex, c.Content, c.Page, c.StartChar, c.TokenCount, c.HeaderBreadcrumb)
		if err != nil {
			return fmt.Errorf("insert chunk %d: %w", c.ChunkIndex, err)
		}
	}
	return nil
}

// DeleteChunks removes all chunks for a document.
func (d *DB) DeleteChunks(docID string) error {
	_, err := d.db.Exec("DELETE FROM document_chunks WHERE document_id = ?", docID)
	return err
}

// SearchChunk represents a search result from FTS5.
type SearchChunk struct {
	DocumentID       string  `json:"document_id"`
	Content          string  `json:"content"`
	Page             int     `json:"page"`
	HeaderBreadcrumb string  `json:"header_breadcrumb"`
	ChunkIndex       int     `json:"chunk_index"`
	Filename         string  `json:"filename"`
	Title            string  `json:"title"`
	Path             string  `json:"path"`
	FileType         string  `json:"file_type"`
	Score            float64 `json:"score"`
}

// SearchChunks performs full-text search. If FTS5 returns no results and the query
// contains CJK characters, falls back to LIKE search.
func (d *DB) SearchChunks(query string, limit int, pathFilter string) ([]SearchChunk, error) {
	results, err := d.searchFTS5(query, limit, pathFilter)
	if err != nil {
		return nil, err
	}

	if len(results) == 0 && hasCJK(query) {
		return d.searchLIKE(query, limit, pathFilter)
	}
	return results, nil
}

func (d *DB) searchFTS5(query string, limit int, pathFilter string) ([]SearchChunk, error) {
	sqlStr := `
		SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
			d.filename, d.title, d.path, d.file_type,
			rank as score
		FROM document_chunks dc
		JOIN chunks_fts fts ON dc.rowid = fts.rowid
		JOIN documents d ON dc.document_id = d.id
		WHERE chunks_fts MATCH ? AND d.status != 'failed' `

	var args []interface{}
	args = append(args, query)

	if pathFilter == "wiki" {
		sqlStr += "AND d.source_kind = 'wiki' "
	} else if pathFilter == "sources" {
		sqlStr += "AND d.source_kind != 'wiki' "
	}

	sqlStr += "ORDER BY rank LIMIT ?"
	args = append(args, limit)

	rows, err := d.db.Query(sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("search chunks: %w", err)
	}
	defer rows.Close()

	var results []SearchChunk
	for rows.Next() {
		var r SearchChunk
		var page, chunkIndex sql.NullInt64
		var headerBreadcrumb sql.NullString
		if err := rows.Scan(&r.DocumentID, &r.Content, &page, &headerBreadcrumb, &chunkIndex,
			&r.Filename, &r.Title, &r.Path, &r.FileType, &r.Score); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}
		if page.Valid {
			r.Page = int(page.Int64)
		}
		if chunkIndex.Valid {
			r.ChunkIndex = int(chunkIndex.Int64)
		}
		if headerBreadcrumb.Valid {
			r.HeaderBreadcrumb = headerBreadcrumb.String
		}
		results = append(results, r)
	}
	return results, nil
}

func (d *DB) searchLIKE(query string, limit int, pathFilter string) ([]SearchChunk, error) {
	sqlStr := `
		SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
			d.filename, d.title, d.path, d.file_type,
			0.0 as score
		FROM document_chunks dc
		JOIN documents d ON dc.document_id = d.id
		WHERE dc.content LIKE ? AND d.status != 'failed' `

	var args []interface{}
	args = append(args, "%"+query+"%")

	if pathFilter == "wiki" {
		sqlStr += "AND d.source_kind = 'wiki' "
	} else if pathFilter == "sources" {
		sqlStr += "AND d.source_kind != 'wiki' "
	}

	sqlStr += "LIMIT ?"
	args = append(args, limit)

	rows, err := d.db.Query(sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("search chunks like: %w", err)
	}
	defer rows.Close()

	var results []SearchChunk
	for rows.Next() {
		var r SearchChunk
		var page, chunkIndex sql.NullInt64
		var headerBreadcrumb sql.NullString
		if err := rows.Scan(&r.DocumentID, &r.Content, &page, &headerBreadcrumb, &chunkIndex,
			&r.Filename, &r.Title, &r.Path, &r.FileType, &r.Score); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}
		if page.Valid {
			r.Page = int(page.Int64)
		}
		if chunkIndex.Valid {
			r.ChunkIndex = int(chunkIndex.Int64)
		}
		if headerBreadcrumb.Valid {
			r.HeaderBreadcrumb = headerBreadcrumb.String
		}
		results = append(results, r)
	}
	return results, nil
}

func hasCJK(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hangul, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) {
			return true
		}
	}
	return false
}
