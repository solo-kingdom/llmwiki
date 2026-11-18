package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// CreateSourceBlob stores raw source bytes. The SHA-256 is computed from data
// when blob.SHA256 is empty. When a blob with the same SHA-256 already exists,
// nothing is written and blob is filled from the stored row (same immutable
// content), so callers always end up with the canonical ID.
func (d *DB) CreateSourceBlob(blob *store.SourceBlob, data []byte) error {
	if blob == nil {
		return fmt.Errorf("nil source blob")
	}
	if blob.ID == "" {
		return fmt.Errorf("source blob id is required")
	}
	if data == nil {
		data = []byte{}
	}
	if blob.SHA256 == "" {
		sum := sha256.Sum256(data)
		blob.SHA256 = hex.EncodeToString(sum[:])
	}
	blob.Size = int64(len(data))

	err := d.pool.QueryRow(context.Background(), `
		INSERT INTO source_blobs (id, document_id, filename, media_type, size, sha256, bytes)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7)
		ON CONFLICT (sha256) DO NOTHING
		RETURNING created_at`,
		blob.ID, blob.DocumentID, blob.Filename, blob.MediaType,
		blob.Size, blob.SHA256, data,
	).Scan(&blob.CreatedAt)
	if err == nil {
		return nil
	}
	if !isNoRows(err) {
		return fmt.Errorf("create source blob: %w", err)
	}

	// Same content already stored: return the existing canonical row.
	if err := d.pool.QueryRow(context.Background(), `
		SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at
		FROM source_blobs WHERE sha256 = $1`, blob.SHA256,
	).Scan(&blob.ID, &blob.DocumentID, &blob.Filename, &blob.MediaType,
		&blob.Size, &blob.SHA256, &blob.CreatedAt); err != nil {
		return fmt.Errorf("fetch existing source blob: %w", err)
	}
	return nil
}

// GetSourceBlob returns blob metadata and bytes by ID. Returns nil, nil, nil if absent.
func (d *DB) GetSourceBlob(id string) (*store.SourceBlob, []byte, error) {
	blob := &store.SourceBlob{}
	var data []byte
	err := d.pool.QueryRow(context.Background(), `
		SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at, bytes
		FROM source_blobs WHERE id = $1`, id,
	).Scan(&blob.ID, &blob.DocumentID, &blob.Filename, &blob.MediaType,
		&blob.Size, &blob.SHA256, &blob.CreatedAt, &data)
	if isNoRows(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return blob, data, nil
}

// GetSourceBlobBySHA returns blob metadata and bytes by SHA-256. Returns nil, nil, nil if absent.
func (d *DB) GetSourceBlobBySHA(sha string) (*store.SourceBlob, []byte, error) {
	blob := &store.SourceBlob{}
	var data []byte
	err := d.pool.QueryRow(context.Background(), `
		SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at, bytes
		FROM source_blobs WHERE sha256 = $1`, sha,
	).Scan(&blob.ID, &blob.DocumentID, &blob.Filename, &blob.MediaType,
		&blob.Size, &blob.SHA256, &blob.CreatedAt, &data)
	if isNoRows(err) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return blob, data, nil
}

// ListSourceBlobs returns metadata for all stored blobs, oldest first.
func (d *DB) ListSourceBlobs() ([]store.SourceBlob, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at
		FROM source_blobs ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []store.SourceBlob
	for rows.Next() {
		var blob store.SourceBlob
		if err := rows.Scan(&blob.ID, &blob.DocumentID, &blob.Filename, &blob.MediaType,
			&blob.Size, &blob.SHA256, &blob.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, blob)
	}
	return out, rows.Err()
}

// DeleteSourceBlob removes a blob by ID.
func (d *DB) DeleteSourceBlob(id string) error {
	tag, err := d.pool.Exec(context.Background(),
		`DELETE FROM source_blobs WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("source blob not found: %s", id)
	}
	return nil
}
