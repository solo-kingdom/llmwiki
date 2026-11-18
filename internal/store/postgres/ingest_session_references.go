package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

const ingestSessionReferenceSelectColumns = `
	COALESCE(id, ''), COALESCE(session_id, ''), COALESCE(document_id, ''),
	COALESCE(relative_path, ''), COALESCE(title, ''), COALESCE(source, ''),
	COALESCE(first_seen_at, '')`

func scanIngestSessionReference(scanner interface{ Scan(...any) error }, ref *store.IngestSessionReference) error {
	return scanner.Scan(
		&ref.ID, &ref.SessionID, &ref.DocumentID, &ref.RelativePath,
		&ref.Title, &ref.Source, &ref.FirstSeenAt,
	)
}

// UpsertSessionReference inserts or updates a session wiki reference.
// user_mention outranks tool_read and is never downgraded.
func (d *DB) UpsertSessionReference(sessionID, documentID, relativePath, title, source string) error {
	sessionID = strings.TrimSpace(sessionID)
	documentID = strings.TrimSpace(documentID)
	if sessionID == "" || documentID == "" {
		return fmt.Errorf("session_id and document_id are required")
	}
	source = strings.TrimSpace(source)
	if source != store.SessionRefSourceUserMention && source != store.SessionRefSourceToolRead {
		return fmt.Errorf("invalid reference source %q", source)
	}
	_, err := d.pool.Exec(context.Background(), `
		INSERT INTO ingest_session_references (
			id, session_id, document_id, relative_path, title, source, first_seen_at
		) VALUES ($1, $2, $3, $4, $5, $6, `+nowText+`)
		ON CONFLICT (session_id, document_id) DO UPDATE SET
			relative_path = excluded.relative_path,
			title = excluded.title,
			source = CASE
				WHEN ingest_session_references.source = $7 AND excluded.source = $8 THEN ingest_session_references.source
				WHEN ingest_session_references.source = $7 THEN ingest_session_references.source
				ELSE excluded.source
			END`,
		uuid.New().String(), sessionID, documentID, relativePath, title, source,
		store.SessionRefSourceUserMention, store.SessionRefSourceToolRead,
	)
	if err != nil {
		return fmt.Errorf("upsert session reference: %w", err)
	}
	return nil
}

// ListSessionReferences returns wiki references for a session ordered by first_seen_at.
func (d *DB) ListSessionReferences(sessionID string) ([]store.IngestSessionReference, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT `+ingestSessionReferenceSelectColumns+`
		FROM ingest_session_references
		WHERE session_id = $1
		ORDER BY first_seen_at ASC, id ASC`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("list session references: %w", err)
	}
	defer rows.Close()
	var out []store.IngestSessionReference
	for rows.Next() {
		var ref store.IngestSessionReference
		if err := scanIngestSessionReference(rows, &ref); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

// CountSessionReference counts how many rows exist for a session/document pair.
func (d *DB) CountSessionReference(sessionID, documentID string) (int, error) {
	var n int
	err := d.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM ingest_session_references
		WHERE session_id = $1 AND document_id = $2`, sessionID, documentID).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}
