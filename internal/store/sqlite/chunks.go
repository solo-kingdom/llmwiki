package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/solo-kingdom/llmwiki/internal/engine"
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

// SearchChunks performs full-text search over chunk content and document metadata
// (filename, title, path). Uses FTS5 when possible and LIKE fallbacks for CJK or misses.
func (d *DB) SearchChunks(query string, limit int, pathFilter string, pageTypes ...string) ([]SearchChunk, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}

	ftsQuery := escapeFTSQuery(query)
	results, ftsErr := d.searchFTS5(ftsQuery, limit, pathFilter)
	if ftsErr != nil {
		results = nil
	}

	meta, err := d.searchMetadata(query, limit, pathFilter)
	if err != nil {
		return nil, err
	}
	results = mergeSearchResults(results, meta, limit)

	if len(results) == 0 {
		like, err := d.searchLIKEBroad(query, limit, pathFilter)
		if err != nil {
			if ftsErr != nil {
				return nil, ftsErr
			}
			return nil, err
		}
		results = mergeSearchResults(results, like, limit)
	}

	if len(results) == 0 && ftsErr != nil {
		return nil, ftsErr
	}

	if len(pageTypes) > 0 {
		results = filterSearchChunksByPageType(results, pageTypes)
	}

	return results, nil
}

func filterSearchChunksByPageType(results []SearchChunk, pageTypes []string) []SearchChunk {
	if len(results) == 0 {
		return results
	}
	typeSet := make(map[string]bool, len(pageTypes))
	for _, t := range pageTypes {
		typeSet[t] = true
	}
	filtered := make([]SearchChunk, 0, len(results))
	for _, r := range results {
		pt := engine.WikiPageTypeFromPaths("", strings.TrimPrefix(r.Path, "/"))
		if typeSet[pt] {
			filtered = append(filtered, r)
		}
	}
	return filtered
}

func escapeFTSQuery(query string) string {
	query = strings.TrimSpace(query)
	if query == "" {
		return query
	}
	if hasCJK(query) {
		return sanitizeFTSLiterals(query)
	}
	terms := strings.Fields(query)
	if len(terms) == 0 {
		return sanitizeFTSLiterals(query)
	}
	parts := make([]string, 0, len(terms))
	for _, t := range terms {
		if t = sanitizeFTSLiterals(t); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, " ")
}

// sanitizeFTSLiterals strips FTS5 operators so trigram MATCH queries stay safe.
func sanitizeFTSLiterals(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '"', '*', ':', '(', ')', '^':
			continue
		case '-':
			if b.Len() == 0 {
				continue
			}
			b.WriteRune(r)
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

func mergeSearchResults(primary, extra []SearchChunk, limit int) []SearchChunk {
	seen := make(map[string]bool, len(primary))
	for _, r := range primary {
		seen[r.DocumentID] = true
	}
	merged := append([]SearchChunk(nil), primary...)
	for _, r := range extra {
		if seen[r.DocumentID] {
			continue
		}
		seen[r.DocumentID] = true
		merged = append(merged, r)
		if len(merged) >= limit {
			break
		}
	}
	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged
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

func (d *DB) searchLIKEBroad(query string, limit int, pathFilter string) ([]SearchChunk, error) {
	chunkHits, err := d.searchLIKE(query, limit, pathFilter)
	if err != nil {
		return nil, err
	}
	metaHits, err := d.searchMetadata(query, limit, pathFilter)
	if err != nil {
		return nil, err
	}
	return mergeSearchResults(chunkHits, metaHits, limit), nil
}

func (d *DB) searchLIKE(query string, limit int, pathFilter string) ([]SearchChunk, error) {
	pattern := "%" + query + "%"
	sqlStr := `
		SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
			d.filename, d.title, d.path, d.file_type,
			0.0 as score
		FROM document_chunks dc
		JOIN documents d ON dc.document_id = d.id
		WHERE dc.content LIKE ? AND d.status != 'failed' `

	var args []interface{}
	args = append(args, pattern)

	if pathFilter == "wiki" {
		sqlStr += "AND d.source_kind = 'wiki' "
	} else if pathFilter == "sources" {
		sqlStr += "AND d.source_kind != 'wiki' "
	}

	sqlStr += "LIMIT ?"
	args = append(args, limit)

	return d.scanSearchRows(sqlStr, args...)
}

func (d *DB) searchMetadata(query string, limit int, pathFilter string) ([]SearchChunk, error) {
	pattern := "%" + query + "%"
	sqlStr := `
		SELECT d.id, COALESCE(SUBSTR(d.content, 1, 300), ''), 0, '', 0,
			d.filename, d.title, d.path, d.file_type,
			0.0 as score
		FROM documents d
		WHERE d.status != 'failed'
		AND (d.filename LIKE ? OR d.title LIKE ? OR d.path LIKE ?) `

	args := []interface{}{pattern, pattern, pattern}

	if pathFilter == "wiki" {
		sqlStr += "AND d.source_kind = 'wiki' "
	} else if pathFilter == "sources" {
		sqlStr += "AND d.source_kind != 'wiki' "
	}

	sqlStr += "LIMIT ?"
	args = append(args, limit)

	return d.scanSearchRows(sqlStr, args...)
}

func (d *DB) scanSearchRows(sqlStr string, args ...interface{}) ([]SearchChunk, error) {
	rows, err := d.db.Query(sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("search query: %w", err)
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
