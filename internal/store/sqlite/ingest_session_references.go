package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
)

const (
	SessionRefSourceUserMention = "user_mention"
	SessionRefSourceToolRead    = "tool_read"
)

// IngestSessionReference tracks a wiki page referenced during session chat.
type IngestSessionReference struct {
	ID           string `json:"id"`
	SessionID    string `json:"session_id"`
	DocumentID   string `json:"document_id"`
	RelativePath string `json:"relative_path"`
	Title        string `json:"title"`
	Source       string `json:"source"`
	FirstSeenAt  string `json:"first_seen_at"`
}

func scanIngestSessionReference(scanner interface{ Scan(...interface{}) error }, ref *IngestSessionReference) error {
	return scanner.Scan(
		&ref.ID, &ref.SessionID, &ref.DocumentID, &ref.RelativePath,
		&ref.Title, &ref.Source, &ref.FirstSeenAt,
	)
}

// UpsertSessionReference inserts or updates a session wiki reference.
func (d *DB) UpsertSessionReference(sessionID, documentID, relativePath, title, source string) error {
	sessionID = strings.TrimSpace(sessionID)
	documentID = strings.TrimSpace(documentID)
	if sessionID == "" || documentID == "" {
		return fmt.Errorf("session_id and document_id are required")
	}
	source = strings.TrimSpace(source)
	if source != SessionRefSourceUserMention && source != SessionRefSourceToolRead {
		return fmt.Errorf("invalid reference source %q", source)
	}
	_, err := d.db.Exec(`
		INSERT INTO ingest_session_references (
			session_id, document_id, relative_path, title, source, first_seen_at
		) VALUES (?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(session_id, document_id) DO UPDATE SET
			relative_path = excluded.relative_path,
			title = excluded.title,
			source = CASE
				WHEN ingest_session_references.source = ? AND excluded.source = ? THEN ingest_session_references.source
				WHEN ingest_session_references.source = ? THEN ingest_session_references.source
				ELSE excluded.source
			END`,
		sessionID, documentID, relativePath, title, source,
		SessionRefSourceUserMention, SessionRefSourceToolRead,
		SessionRefSourceUserMention,
	)
	if err != nil {
		return fmt.Errorf("upsert session reference: %w", err)
	}
	return nil
}

// ListSessionReferences returns wiki references for a session ordered by first_seen_at.
func (d *DB) ListSessionReferences(sessionID string) ([]IngestSessionReference, error) {
	rows, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(session_id,''), COALESCE(document_id,''),
		       COALESCE(relative_path,''), COALESCE(title,''), COALESCE(source,''),
		       COALESCE(first_seen_at,'')
		FROM ingest_session_references
		WHERE session_id = ?
		ORDER BY datetime(first_seen_at) ASC`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("list session references: %w", err)
	}
	defer rows.Close()
	var out []IngestSessionReference
	for rows.Next() {
		var ref IngestSessionReference
		if err := scanIngestSessionReference(rows, &ref); err != nil {
			return nil, err
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

// GetWikiDocumentByID returns a wiki document by id or nil if missing/not wiki.
func (d *DB) GetWikiDocumentByID(id string) (*Document, error) {
	doc, err := d.GetDocument(id)
	if err != nil {
		return nil, err
	}
	if doc == nil || doc.SourceKind != "wiki" || doc.Status == "failed" {
		return nil, nil
	}
	return doc, nil
}

// ListWikiGraphEdges returns links_to edges as source->target relative paths.
func (d *DB) ListWikiGraphEdges() ([]GraphEdge, error) {
	rows, err := d.db.Query(`
		SELECT src.relative_path, tgt.relative_path, dr.reference_type
		FROM document_references dr
		JOIN documents src ON dr.source_document_id = src.id
		JOIN documents tgt ON dr.target_document_id = tgt.id
		WHERE dr.reference_type = 'links_to'
		  AND src.status != 'failed' AND tgt.status != 'failed'
		  AND src.source_kind = 'wiki' AND tgt.source_kind = 'wiki'
		  AND src.relative_path != '' AND tgt.relative_path != ''`)
	if err != nil {
		return nil, fmt.Errorf("list wiki graph edges: %w", err)
	}
	defer rows.Close()
	var out []GraphEdge
	for rows.Next() {
		var e GraphEdge
		if err := rows.Scan(&e.Source, &e.Target, &e.Type); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// CountSessionReference is used in tests to verify upsert behavior.
func (d *DB) CountSessionReference(sessionID, documentID string) (int, error) {
	var n int
	err := d.db.QueryRow(`
		SELECT COUNT(*) FROM ingest_session_references
		WHERE session_id = ? AND document_id = ?`, sessionID, documentID).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return n, err
}
