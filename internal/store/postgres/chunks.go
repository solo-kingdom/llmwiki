package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// StoreChunks replaces all chunks for a document with the given chunks.
func (d *DB) StoreChunks(docID string, chunks []store.Chunk) error {
	ctx := context.Background()
	if _, err := d.pool.Exec(ctx, "DELETE FROM document_chunks WHERE document_id = $1", docID); err != nil {
		return fmt.Errorf("delete chunks: %w", err)
	}
	for _, c := range chunks {
		id := uuid.NewString()
		_, err := d.pool.Exec(ctx, `
			INSERT INTO document_chunks (id, document_id, chunk_index, content, page, start_char, token_count, header_breadcrumb)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			id, docID, c.ChunkIndex, c.Content, c.Page, c.StartChar, c.TokenCount, c.HeaderBreadcrumb)
		if err != nil {
			return fmt.Errorf("insert chunk %d: %w", c.ChunkIndex, err)
		}
	}
	return nil
}

// DeleteChunks removes all chunks for a document.
func (d *DB) DeleteChunks(docID string) error {
	_, err := d.pool.Exec(context.Background(), "DELETE FROM document_chunks WHERE document_id = $1", docID)
	return err
}

// pathFilterClause returns the SQL fragment restricting a search to wiki or
// source documents. Callers append it after their own WHERE conditions.
func pathFilterClause(pathFilter string) string {
	switch pathFilter {
	case "wiki":
		return "AND d.source_kind = 'wiki' AND NOT (" + hiddenSubdirsWhere("d.relative_path") + ") "
	case "sources":
		return "AND d.source_kind != 'wiki' "
	}
	return ""
}

// SearchChunks performs full-text search over chunk content and document
// metadata (filename, title, path). It mirrors the SQLite three-stage search:
// FTS (with ILIKE for CJK), metadata LIKE, then a broad content ILIKE fallback
// only when nothing matched.
func (d *DB) SearchChunks(query string, limit int, pathFilter string, pageTypes ...string) ([]store.SearchChunk, error) {
	ctx := context.Background()
	query = strings.TrimSpace(query)
	if query == "" || limit <= 0 {
		return nil, nil
	}

	results, ftsErr := d.searchFTS(ctx, query, limit, pathFilter)
	if ftsErr != nil {
		results = nil
	}

	meta, err := d.searchMetadata(ctx, query, limit, pathFilter)
	if err != nil {
		return nil, err
	}
	results = mergeSearchResults(results, meta, limit)

	if len(results) == 0 {
		like, err := d.searchLIKEBroad(ctx, query, limit, pathFilter)
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

func filterSearchChunksByPageType(results []store.SearchChunk, pageTypes []string) []store.SearchChunk {
	if len(results) == 0 {
		return results
	}
	typeSet := make(map[string]bool, len(pageTypes))
	for _, t := range pageTypes {
		typeSet[t] = true
	}
	filtered := make([]store.SearchChunk, 0, len(results))
	for _, r := range results {
		pt := engine.WikiPageTypeFromPaths("", strings.TrimPrefix(r.Path, "/"))
		if typeSet[pt] {
			filtered = append(filtered, r)
		}
	}
	return filtered
}

func mergeSearchResults(primary, extra []store.SearchChunk, limit int) []store.SearchChunk {
	seen := make(map[string]bool, len(primary)+len(extra))
	merged := make([]store.SearchChunk, 0, limit)
	for _, group := range [][]store.SearchChunk{primary, extra} {
		for _, r := range group {
			if seen[r.DocumentID] {
				continue
			}
			seen[r.DocumentID] = true
			merged = append(merged, r)
			if len(merged) >= limit {
				return merged
			}
		}
	}
	return merged
}

func (d *DB) searchFTS(ctx context.Context, query string, limit int, pathFilter string) ([]store.SearchChunk, error) {
	sqlStr := `
		SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
			d.filename, d.title, d.path, d.file_type,
			(ts_rank_cd(to_tsvector('simple', dc.content), websearch_to_tsquery('simple', $1))
			 + similarity(dc.content, $1)) AS score
		FROM document_chunks dc
		JOIN documents d ON dc.document_id = d.id
		WHERE d.status != 'failed' AND d.deleted_at IS NULL
		  AND (to_tsvector('simple', dc.content) @@ websearch_to_tsquery('simple', $1)
		       OR dc.content ILIKE '%' || $1 || '%') `
	sqlStr += pathFilterClause(pathFilter)
	sqlStr += "ORDER BY score DESC, dc.chunk_index LIMIT $2"

	rows, err := d.pool.Query(ctx, sqlStr, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search chunks: %w", err)
	}
	defer rows.Close()
	return scanSearchChunkRows(rows)
}

func (d *DB) searchLIKEBroad(ctx context.Context, query string, limit int, pathFilter string) ([]store.SearchChunk, error) {
	chunkHits, err := d.searchLIKE(ctx, query, limit, pathFilter)
	if err != nil {
		return nil, err
	}
	metaHits, err := d.searchMetadata(ctx, query, limit, pathFilter)
	if err != nil {
		return nil, err
	}
	return mergeSearchResults(chunkHits, metaHits, limit), nil
}

func (d *DB) searchLIKE(ctx context.Context, query string, limit int, pathFilter string) ([]store.SearchChunk, error) {
	sqlStr := `
		SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
			d.filename, d.title, d.path, d.file_type,
			0.0 AS score
		FROM document_chunks dc
		JOIN documents d ON dc.document_id = d.id
		WHERE dc.content ILIKE '%' || $1 || '%' AND d.status != 'failed' AND d.deleted_at IS NULL `
	sqlStr += pathFilterClause(pathFilter)
	sqlStr += "LIMIT $2"

	rows, err := d.pool.Query(ctx, sqlStr, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search query: %w", err)
	}
	defer rows.Close()
	return scanSearchChunkRows(rows)
}

func (d *DB) searchMetadata(ctx context.Context, query string, limit int, pathFilter string) ([]store.SearchChunk, error) {
	sqlStr := `
		SELECT d.id, COALESCE(SUBSTR(d.content, 1, 300), ''), 0, '', 0,
			d.filename, d.title, d.path, d.file_type,
			0.0 AS score
		FROM documents d
		WHERE d.status != 'failed' AND d.deleted_at IS NULL
		  AND (d.filename ILIKE '%' || $1 || '%'
		       OR d.title ILIKE '%' || $1 || '%'
		       OR d.path ILIKE '%' || $1 || '%') `
	sqlStr += pathFilterClause(pathFilter)
	sqlStr += "LIMIT $2"

	rows, err := d.pool.Query(ctx, sqlStr, query, limit)
	if err != nil {
		return nil, fmt.Errorf("search query: %w", err)
	}
	defer rows.Close()
	return scanSearchChunkRows(rows)
}

func scanSearchChunkRows(rows pgx.Rows) ([]store.SearchChunk, error) {
	var results []store.SearchChunk
	for rows.Next() {
		var r store.SearchChunk
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
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan search result: %w", err)
	}
	return results, nil
}
