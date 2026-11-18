package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// StoreChunkEmbeddings upserts embeddings for chunks keyed by (chunk_id, model).
func (d *DB) StoreChunkEmbeddings(embeddings []store.ChunkEmbedding) error {
	if len(embeddings) == 0 {
		return nil
	}
	ctx := context.Background()
	err := d.withTx(ctx, func(tx pgx.Tx) error {
		for _, e := range embeddings {
			dim := e.Dim
			if dim <= 0 {
				dim = len(e.Embedding)
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO chunk_embeddings (chunk_id, model, dim, embedding)
				VALUES ($1, $2, $3, $4::vector)
				ON CONFLICT (chunk_id, model) DO UPDATE
				SET dim = EXCLUDED.dim,
					embedding = EXCLUDED.embedding,
					created_at = `+nowText,
				e.ChunkID, e.Model, dim, formatVector(e.Embedding)); err != nil {
				return fmt.Errorf("upsert embedding for chunk %s: %w", e.ChunkID, err)
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("store chunk embeddings: %w", err)
	}
	return nil
}

// SearchVector returns chunks ordered by cosine distance to the query vector.
func (d *DB) SearchVector(vector []float32, model string, limit int, pathFilter string, pageTypes ...string) ([]store.SearchChunk, error) {
	if len(vector) == 0 || limit <= 0 {
		return nil, nil
	}
	ctx := context.Background()
	sqlStr := `
		SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
			d.filename, d.title, d.path, d.file_type,
			(1 - (ce.embedding <=> $1::vector)) AS score
		FROM chunk_embeddings ce
		JOIN document_chunks dc ON dc.id = ce.chunk_id
		JOIN documents d ON dc.document_id = d.id
		WHERE ce.model = $2 AND d.status != 'failed' AND d.deleted_at IS NULL `
	sqlStr += pathFilterClause(pathFilter)
	sqlStr += "ORDER BY ce.embedding <=> $1::vector LIMIT $3"

	rows, err := d.pool.Query(ctx, sqlStr, formatVector(vector), model, limit)
	if err != nil {
		return nil, fmt.Errorf("search vector: %w", err)
	}
	defer rows.Close()

	results, err := scanSearchChunkRows(rows)
	if err != nil {
		return nil, err
	}
	if len(pageTypes) > 0 {
		results = filterSearchChunksByPageType(results, pageTypes)
	}
	return results, nil
}

// ChunksMissingEmbedding returns chunks of non-deleted documents that have no
// embedding for the given model.
func (d *DB) ChunksMissingEmbedding(model string, limit int) ([]store.Chunk, error) {
	if limit <= 0 {
		return nil, nil
	}
	rows, err := d.pool.Query(context.Background(), `
		SELECT dc.document_id, dc.chunk_index, dc.content, dc.page, dc.start_char,
			dc.token_count, dc.header_breadcrumb
		FROM document_chunks dc
		JOIN documents d ON dc.document_id = d.id
		LEFT JOIN chunk_embeddings ce ON ce.chunk_id = dc.id AND ce.model = $1
		WHERE ce.chunk_id IS NULL AND d.status != 'failed' AND d.deleted_at IS NULL
		ORDER BY dc.document_id, dc.chunk_index
		LIMIT $2`, model, limit)
	if err != nil {
		return nil, fmt.Errorf("chunks missing embedding: %w", err)
	}
	defer rows.Close()

	var chunks []store.Chunk
	for rows.Next() {
		var c store.Chunk
		var page, startChar sql.NullInt64
		var headerBreadcrumb sql.NullString
		if err := rows.Scan(&c.DocumentID, &c.ChunkIndex, &c.Content, &page, &startChar,
			&c.TokenCount, &headerBreadcrumb); err != nil {
			return nil, fmt.Errorf("chunks missing embedding: %w", err)
		}
		if page.Valid {
			c.Page = int(page.Int64)
		}
		if startChar.Valid {
			c.StartChar = int(startChar.Int64)
		}
		if headerBreadcrumb.Valid {
			c.HeaderBreadcrumb = headerBreadcrumb.String
		}
		chunks = append(chunks, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chunks missing embedding: %w", err)
	}
	return chunks, nil
}

// formatVector renders a float32 slice as a pgvector text literal.
func formatVector(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 8)
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', -1, 32))
	}
	b.WriteByte(']')
	return b.String()
}
