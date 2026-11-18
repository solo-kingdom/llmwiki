package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

const ingestSessionSelectColumns = `
	COALESCE(id, ''), COALESCE(title, ''), COALESCE(status, ''),
	COALESCE(storage_path, ''), COALESCE(llm_instance_id, ''), COALESCE(llm_model, ''),
	COALESCE(mode, 'ingest'), COALESCE(agent_kind, 'native'), COALESCE(acp_agent_id, ''),
	COALESCE(created_at, ''), COALESCE(updated_at, '')`

const ingestSessionMessageSelectColumns = `
	COALESCE(id, ''), COALESCE(session_id, ''), COALESCE(role, ''),
	COALESCE(content, ''), COALESCE(message_type, ''), COALESCE(attachment_id, ''),
	COALESCE(stream_status, ''), COALESCE(wiki_refs_json, '[]'),
	COALESCE(exclude_from_archive, FALSE), COALESCE(created_at, '')`

func scanIngestSession(scanner interface{ Scan(...any) error }, s *store.IngestSession) error {
	return scanner.Scan(
		&s.ID, &s.Title, &s.Status, &s.StoragePath,
		&s.LLMInstanceID, &s.LLMModel, &s.Mode, &s.AgentKind, &s.ACPAgentID,
		&s.CreatedAt, &s.UpdatedAt,
	)
}

func scanIngestSessionMessage(scanner interface{ Scan(...any) error }, m *store.IngestSessionMessage) error {
	return scanner.Scan(
		&m.ID, &m.SessionID, &m.Role, &m.Content, &m.MessageType,
		&m.AttachmentID, &m.StreamStatus, &m.WikiRefsJSON, &m.ExcludeFromArchive, &m.CreatedAt,
	)
}

func sessionWikiRefsJSON(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return "[]"
	}
	return raw
}

func (d *DB) CountIngestSessions() (int, error) {
	var n int
	err := d.pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM ingest_sessions`).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count ingest sessions: %w", err)
	}
	return n, nil
}

func (d *DB) CreateIngestSession(session *store.IngestSession) error {
	if session == nil {
		return fmt.Errorf("nil ingest session")
	}
	if session.Status == "" {
		session.Status = "active"
	}
	if session.Mode == "" {
		session.Mode = "ingest"
	}
	if session.AgentKind == "" {
		session.AgentKind = "native"
	}
	err := scanIngestSession(d.pool.QueryRow(context.Background(), `
		INSERT INTO ingest_sessions (
			id, title, status, storage_path, llm_instance_id, llm_model,
			mode, agent_kind, acp_agent_id, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, `+nowText+`, `+nowText+`)
		RETURNING `+ingestSessionSelectColumns,
		uuid.New().String(),
		strings.TrimSpace(session.Title),
		session.Status,
		strings.TrimSpace(session.StoragePath),
		session.LLMInstanceID,
		session.LLMModel,
		session.Mode,
		session.AgentKind,
		strings.TrimSpace(session.ACPAgentID),
	), session)
	if err != nil {
		return fmt.Errorf("create ingest session: %w", err)
	}
	return nil
}

func (d *DB) GetIngestSession(id string) (*store.IngestSession, error) {
	s := &store.IngestSession{}
	err := scanIngestSession(d.pool.QueryRow(context.Background(), `
		SELECT `+ingestSessionSelectColumns+`
		FROM ingest_sessions WHERE id = $1`, id), s)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("get ingest session: %w", err)
	}
	return s, nil
}

func (d *DB) ListIngestSessions() ([]store.IngestSession, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT `+ingestSessionSelectColumns+`
		FROM ingest_sessions
		ORDER BY updated_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list ingest sessions: %w", err)
	}
	defer rows.Close()
	var out []store.IngestSession
	for rows.Next() {
		var s store.IngestSession
		if err := scanIngestSession(rows, &s); err != nil {
			return nil, fmt.Errorf("scan ingest session: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (d *DB) UpdateIngestSessionStoragePath(id, path string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_sessions SET storage_path = $1, updated_at = `+nowText+` WHERE id = $2`,
		path, id)
	return err
}

func (d *DB) UpdateIngestSessionTitle(id, title string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_sessions SET title = $1, updated_at = `+nowText+` WHERE id = $2`,
		strings.TrimSpace(title), id)
	return err
}

func (d *DB) UpdateIngestSessionStatus(id, status string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_sessions SET status = $1, updated_at = `+nowText+` WHERE id = $2`,
		status, id)
	return err
}

func (d *DB) UpdateIngestSessionMode(id, mode string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_sessions SET mode = $1, updated_at = `+nowText+` WHERE id = $2`,
		mode, id)
	return err
}

func (d *DB) UpdateIngestSessionAgent(id, agentKind, acpAgentID string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_sessions
		SET agent_kind = $1, acp_agent_id = $2, updated_at = `+nowText+`
		WHERE id = $3`, agentKind, acpAgentID, id)
	return err
}

func (d *DB) UpdateIngestSessionLLM(id, instanceID, model string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_sessions SET llm_instance_id = $1, llm_model = $2, updated_at = `+nowText+`
		WHERE id = $3`, instanceID, model, id)
	return err
}

func (d *DB) DeleteIngestSession(id string) error {
	tag, err := d.pool.Exec(context.Background(), `DELETE FROM ingest_sessions WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete ingest session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("session not found")
	}
	return nil
}

func (d *DB) CreateIngestSessionMessage(msg *store.IngestSessionMessage) error {
	if msg == nil {
		return fmt.Errorf("nil message")
	}
	if msg.Role == "" {
		return fmt.Errorf("role is required")
	}
	if msg.MessageType == "" {
		msg.MessageType = "text"
	}
	if msg.StreamStatus == "" {
		msg.StreamStatus = "complete"
	}
	ctx := context.Background()
	err := scanIngestSessionMessage(d.pool.QueryRow(ctx, `
		INSERT INTO ingest_session_messages (
			id, session_id, role, content, message_type, attachment_id,
			stream_status, wiki_refs_json, exclude_from_archive, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, `+nowText+`)
		RETURNING `+ingestSessionMessageSelectColumns,
		uuid.New().String(),
		msg.SessionID,
		msg.Role,
		msg.Content,
		msg.MessageType,
		strings.TrimSpace(msg.AttachmentID),
		msg.StreamStatus,
		sessionWikiRefsJSON(msg.WikiRefsJSON),
		msg.ExcludeFromArchive,
	), msg)
	if err != nil {
		return fmt.Errorf("create session message: %w", err)
	}
	_, _ = d.pool.Exec(ctx, `UPDATE ingest_sessions SET updated_at = `+nowText+` WHERE id = $1`, msg.SessionID)
	return nil
}

func (d *DB) GetIngestSessionMessage(id string) (*store.IngestSessionMessage, error) {
	m := &store.IngestSessionMessage{}
	err := scanIngestSessionMessage(d.pool.QueryRow(context.Background(), `
		SELECT `+ingestSessionMessageSelectColumns+`
		FROM ingest_session_messages WHERE id = $1`, id), m)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return m, nil
}

func (d *DB) ListIngestSessionMessages(sessionID string) ([]store.IngestSessionMessage, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT `+ingestSessionMessageSelectColumns+`
		FROM ingest_session_messages
		WHERE session_id = $1
		ORDER BY created_at ASC, id ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.IngestSessionMessage
	for rows.Next() {
		var m store.IngestSessionMessage
		if err := scanIngestSessionMessage(rows, &m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (d *DB) UpdateIngestSessionMessageContent(id, content, streamStatus string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_session_messages
		SET content = $1, stream_status = $2
		WHERE id = $3`, content, streamStatus, id)
	return err
}

func (d *DB) UpdateIngestSessionMessageExclude(id string, exclude bool) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_session_messages
		SET exclude_from_archive = $1
		WHERE id = $2`, exclude, id)
	return err
}

func (d *DB) CountUserSessionMessages(sessionID string) (int, error) {
	var n int
	err := d.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM ingest_session_messages
		WHERE session_id = $1 AND role = 'user'`, sessionID).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}
