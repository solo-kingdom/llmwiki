package sqlite

import (
	"encoding/json"
	"fmt"
	"strings"
)

// SessionMessageEvent is a single debug trace row for a chat session message.
type SessionMessageEvent struct {
	ID        int64  `json:"id"`
	MessageID string `json:"message_id"`
	Step      string `json:"step"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	Payload   string `json:"payload"`
	CreatedAt string `json:"created_at"`
}

const (
	DefaultSessionMsgEventsMaxCount = 100
	MinSessionMsgEventsMaxCount     = 10
	MaxSessionMsgEventsMaxCount     = 500
)

// InsertSessionMessageEvent appends an event and trims per-message retention.
func (d *DB) InsertSessionMessageEvent(messageID, step, phase, message string, payload map[string]any, maxPerMessage int) error {
	if maxPerMessage <= 0 {
		maxPerMessage = DefaultSessionMsgEventsMaxCount
	}
	payloadJSON := ""
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("marshal session message event payload: %w", err)
		}
		payloadJSON = string(b)
	}
	_, err := d.db.Exec(`
		INSERT INTO session_message_events (message_id, step, phase, message, payload, created_at)
		VALUES (?, ?, ?, ?, ?, datetime('now'))`,
		messageID, step, phase, message, payloadJSON,
	)
	if err != nil {
		return fmt.Errorf("insert session message event: %w", err)
	}
	return d.TrimSessionMessageEvents(messageID, maxPerMessage)
}

// ListSessionMessageEvents returns events for a message in chronological order.
func (d *DB) ListSessionMessageEvents(messageID string, limit int) ([]SessionMessageEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	rows, err := d.db.Query(`
		SELECT id, message_id, step, phase, COALESCE(message, ''), COALESCE(payload, ''), COALESCE(created_at, '')
		FROM session_message_events
		WHERE message_id = ?
		ORDER BY id ASC
		LIMIT ?`, messageID, limit)
	if err != nil {
		return nil, fmt.Errorf("list session message events: %w", err)
	}
	defer rows.Close()

	var events []SessionMessageEvent
	for rows.Next() {
		var e SessionMessageEvent
		if err := rows.Scan(&e.ID, &e.MessageID, &e.Step, &e.Phase, &e.Message, &e.Payload, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan session message event: %w", err)
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// TrimSessionMessageEvents keeps only the newest maxCount events for a message.
func (d *DB) TrimSessionMessageEvents(messageID string, maxCount int) error {
	if maxCount <= 0 {
		return nil
	}
	_, err := d.db.Exec(`
		DELETE FROM session_message_events
		WHERE message_id = ?
		AND id NOT IN (
			SELECT id FROM session_message_events
			WHERE message_id = ?
			ORDER BY id DESC
			LIMIT ?
		)`, messageID, messageID, maxCount)
	if err != nil {
		return fmt.Errorf("trim session message events: %w", err)
	}
	return nil
}

// ParseSessionMsgEventsMaxCount validates configured per-message event retention.
func ParseSessionMsgEventsMaxCount(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return DefaultSessionMsgEventsMaxCount, nil
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, fmt.Errorf("invalid session_message_events_max_count: %q", s)
	}
	if n < MinSessionMsgEventsMaxCount || n > MaxSessionMsgEventsMaxCount {
		return 0, fmt.Errorf("session_message_events_max_count must be between %d and %d", MinSessionMsgEventsMaxCount, MaxSessionMsgEventsMaxCount)
	}
	return n, nil
}

// GetSessionMsgEventsMaxCount reads retention from config.
func (d *DB) GetSessionMsgEventsMaxCount() int {
	if d == nil {
		return DefaultSessionMsgEventsMaxCount
	}
	raw, _ := d.GetConfig("session_message_events_max_count")
	n, err := ParseSessionMsgEventsMaxCount(raw)
	if err != nil {
		return DefaultSessionMsgEventsMaxCount
	}
	return n
}
