package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
)

type IngestSession struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	Status         string `json:"status"`
	StoragePath    string `json:"storage_path"`
	LLMInstanceID  string `json:"llm_instance_id"`
	LLMModel       string `json:"llm_model"`
	Mode           string `json:"mode"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

type IngestSessionMessage struct {
	ID                   string `json:"id"`
	SessionID            string `json:"session_id"`
	Role                 string `json:"role"`
	Content              string `json:"content"`
	MessageType          string `json:"message_type"`
	AttachmentID         string `json:"attachment_id"`
	StreamStatus         string `json:"stream_status"`
	WikiRefsJSON         string `json:"wiki_refs_json,omitempty"`
	ExcludeFromArchive   bool   `json:"exclude_from_archive"`
	CreatedAt            string `json:"created_at"`
}

func scanIngestSession(scanner interface{ Scan(...interface{}) error }, s *IngestSession) error {
	return scanner.Scan(
		&s.ID, &s.Title, &s.Status, &s.StoragePath,
		&s.LLMInstanceID, &s.LLMModel, &s.Mode,
		&s.CreatedAt, &s.UpdatedAt,
	)
}

func scanIngestSessionMessage(scanner interface{ Scan(...interface{}) error }, m *IngestSessionMessage) error {
	return scanner.Scan(
		&m.ID, &m.SessionID, &m.Role, &m.Content, &m.MessageType,
		&m.AttachmentID, &m.StreamStatus, &m.WikiRefsJSON, &m.ExcludeFromArchive, &m.CreatedAt,
	)
}

func (d *DB) CountIngestSessions() (int, error) {
	var n int
	err := d.db.QueryRow(`SELECT COUNT(*) FROM ingest_sessions`).Scan(&n)
	return n, err
}

func (d *DB) CreateIngestSession(session *IngestSession) error {
	if session == nil {
		return fmt.Errorf("nil ingest session")
	}
	if session.Status == "" {
		session.Status = "active"
	}
	if session.Mode == "" {
		session.Mode = "ingest"
	}
	_, err := d.db.Exec(`
		INSERT INTO ingest_sessions (title, status, storage_path, llm_instance_id, llm_model, mode, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
		strings.TrimSpace(session.Title),
		session.Status,
		strings.TrimSpace(session.StoragePath),
		session.LLMInstanceID,
		session.LLMModel,
		session.Mode,
	)
	if err != nil {
		return fmt.Errorf("create ingest session: %w", err)
	}
	created, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(title,''), COALESCE(status,''),
		       COALESCE(storage_path,''), COALESCE(llm_instance_id,''), COALESCE(llm_model,''),
		       COALESCE(mode,'ingest'),
		       COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM ingest_sessions WHERE rowid = last_insert_rowid()`)
	if err != nil {
		return err
	}
	defer created.Close()
	if created.Next() {
		if err := scanIngestSession(created, session); err != nil {
			return err
		}
	}
	return created.Err()
}

func (d *DB) GetIngestSession(id string) (*IngestSession, error) {
	s := &IngestSession{}
	err := scanIngestSession(d.db.QueryRow(`
		SELECT COALESCE(id,''), COALESCE(title,''), COALESCE(status,''),
		       COALESCE(storage_path,''), COALESCE(llm_instance_id,''), COALESCE(llm_model,''),
		       COALESCE(mode,'ingest'),
		       COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM ingest_sessions WHERE id = ?`, id), s)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get ingest session: %w", err)
	}
	return s, nil
}

func (d *DB) UpdateIngestSessionStoragePath(id, path string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_sessions SET storage_path = ?, updated_at = datetime('now') WHERE id = ?`,
		path, id)
	return err
}

func (d *DB) UpdateIngestSessionTitle(id, title string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`,
		strings.TrimSpace(title), id)
	return err
}

func (d *DB) UpdateIngestSessionStatus(id, status string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`,
		status, id)
	return err
}

func (d *DB) UpdateIngestSessionMode(id, mode string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_sessions SET mode = ?, updated_at = datetime('now') WHERE id = ?`,
		mode, id)
	return err
}

// MigrateAddSessionMode adds the mode column to ingest_sessions if missing.
func MigrateAddSessionMode(d *DB) error {
	var hasMode bool
	row := d.db.QueryRow(`SELECT COUNT(*) > 0 FROM pragma_table_info('ingest_sessions') WHERE name = 'mode'`)
	if err := row.Scan(&hasMode); err != nil {
		return fmt.Errorf("check mode column: %w", err)
	}
	if hasMode {
		return nil
	}
	_, err := d.db.Exec(`ALTER TABLE ingest_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'ingest' CHECK(mode IN ('ingest','qa','organize'))`)
	return err
}

func (d *DB) CreateIngestSessionMessage(msg *IngestSessionMessage) error {
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
	_, err := d.db.Exec(`
		INSERT INTO ingest_session_messages (
			session_id, role, content, message_type, attachment_id, stream_status, wiki_refs_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
		msg.SessionID,
		msg.Role,
		msg.Content,
		msg.MessageType,
		strings.TrimSpace(msg.AttachmentID),
		msg.StreamStatus,
		defaultWikiRefsJSON(msg.WikiRefsJSON),
	)
	if err != nil {
		return fmt.Errorf("create session message: %w", err)
	}
	created, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(session_id,''), COALESCE(role,''),
		       COALESCE(content,''), COALESCE(message_type,''), COALESCE(attachment_id,''),
		       COALESCE(stream_status,''), COALESCE(wiki_refs_json,'[]'),
		       COALESCE(exclude_from_archive,0), COALESCE(created_at,'')
		FROM ingest_session_messages WHERE rowid = last_insert_rowid()`)
	if err != nil {
		return err
	}
	if created.Next() {
		if err := scanIngestSessionMessage(created, msg); err != nil {
			_ = created.Close()
			return err
		}
	}
	if err := created.Close(); err != nil {
		return err
	}
	_, _ = d.db.Exec(`UPDATE ingest_sessions SET updated_at = datetime('now') WHERE id = ?`, msg.SessionID)
	return nil
}

func (d *DB) GetIngestSessionMessage(id string) (*IngestSessionMessage, error) {
	m := &IngestSessionMessage{}
	err := scanIngestSessionMessage(d.db.QueryRow(`
		SELECT COALESCE(id,''), COALESCE(session_id,''), COALESCE(role,''),
		       COALESCE(content,''), COALESCE(message_type,''), COALESCE(attachment_id,''),
		       COALESCE(stream_status,''), COALESCE(wiki_refs_json,'[]'),
		       COALESCE(exclude_from_archive,0), COALESCE(created_at,'')
		FROM ingest_session_messages WHERE id = ?`, id), m)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return m, nil
}

func (d *DB) ListIngestSessionMessages(sessionID string) ([]IngestSessionMessage, error) {
	rows, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(session_id,''), COALESCE(role,''),
		       COALESCE(content,''), COALESCE(message_type,''), COALESCE(attachment_id,''),
		       COALESCE(stream_status,''), COALESCE(wiki_refs_json,'[]'),
		       COALESCE(exclude_from_archive,0), COALESCE(created_at,'')
		FROM ingest_session_messages
		WHERE session_id = ?
		ORDER BY datetime(created_at) ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IngestSessionMessage
	for rows.Next() {
		var m IngestSessionMessage
		if err := scanIngestSessionMessage(rows, &m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (d *DB) UpdateIngestSessionMessageContent(id, content, streamStatus string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_session_messages
		SET content = ?, stream_status = ?
		WHERE id = ?`, content, streamStatus, id)
	return err
}

func (d *DB) UpdateIngestSessionMessageExclude(id string, exclude bool) error {
	_, err := d.db.Exec(`
		UPDATE ingest_session_messages
		SET exclude_from_archive = ?
		WHERE id = ?`, exclude, id)
	return err
}

func (d *DB) CountUserSessionMessages(sessionID string) (int, error) {
	var n int
	err := d.db.QueryRow(`
		SELECT COUNT(*) FROM ingest_session_messages
		WHERE session_id = ? AND role = 'user'`, sessionID).Scan(&n)
	return n, err
}

func (d *DB) ListIngestSessions() ([]IngestSession, error) {
	rows, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(title,''), COALESCE(status,''),
		       COALESCE(storage_path,''), COALESCE(llm_instance_id,''), COALESCE(llm_model,''),
		       COALESCE(mode,'ingest'),
		       COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM ingest_sessions
		ORDER BY datetime(updated_at) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IngestSession
	for rows.Next() {
		var s IngestSession
		if err := scanIngestSession(rows, &s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (d *DB) UpdateIngestSessionLLM(id, instanceID, model string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_sessions SET llm_instance_id = ?, llm_model = ?, updated_at = datetime('now')
		WHERE id = ?`, instanceID, model, id)
	return err
}

func (d *DB) DeleteIngestSession(id string) error {
	res, err := d.db.Exec(`DELETE FROM ingest_sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete ingest session: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("session not found")
	}
	return nil
}

func defaultWikiRefsJSON(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return "[]"
	}
	return raw
}
