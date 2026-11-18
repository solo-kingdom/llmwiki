package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// InsertSessionMessageEvent appends an event and trims per-message retention.
func (d *DB) InsertSessionMessageEvent(messageID, step, phase, message string, payload map[string]any, maxPerMessage int) error {
	if maxPerMessage <= 0 {
		maxPerMessage = store.DefaultSessionMsgEventsMaxCount
	}
	payloadJSON := ""
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("marshal session message event payload: %w", err)
		}
		payloadJSON = string(b)
	}
	_, err := d.pool.Exec(context.Background(), `
		INSERT INTO session_message_events (message_id, step, phase, message, payload, created_at)
		VALUES ($1, $2, $3, $4, $5, `+nowText+`)`,
		messageID, step, phase, message, payloadJSON,
	)
	if err != nil {
		return fmt.Errorf("insert session message event: %w", err)
	}
	return d.TrimSessionMessageEvents(messageID, maxPerMessage)
}

// ListSessionMessageEvents returns events for a message in chronological order.
func (d *DB) ListSessionMessageEvents(messageID string, limit int) ([]store.SessionMessageEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	rows, err := d.pool.Query(context.Background(), `
		SELECT id, message_id, step, phase, COALESCE(message, ''), COALESCE(payload, ''), COALESCE(created_at, '')
		FROM session_message_events
		WHERE message_id = $1
		ORDER BY id ASC
		LIMIT $2`, messageID, limit)
	if err != nil {
		return nil, fmt.Errorf("list session message events: %w", err)
	}
	defer rows.Close()

	var events []store.SessionMessageEvent
	for rows.Next() {
		var e store.SessionMessageEvent
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
	_, err := d.pool.Exec(context.Background(), `
		DELETE FROM session_message_events
		WHERE message_id = $1
		AND id NOT IN (
			SELECT id FROM session_message_events
			WHERE message_id = $2
			ORDER BY id DESC
			LIMIT $3
		)`, messageID, messageID, maxCount)
	if err != nil {
		return fmt.Errorf("trim session message events: %w", err)
	}
	return nil
}

func parseSessionMsgEventsMaxCount(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return store.DefaultSessionMsgEventsMaxCount
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return store.DefaultSessionMsgEventsMaxCount
	}
	if n < store.MinSessionMsgEventsMaxCount {
		return store.MinSessionMsgEventsMaxCount
	}
	if n > store.MaxSessionMsgEventsMaxCount {
		return store.MaxSessionMsgEventsMaxCount
	}
	return n
}

// GetSessionMsgEventsMaxCount reads retention from config.
func (d *DB) GetSessionMsgEventsMaxCount() int {
	if d == nil {
		return store.DefaultSessionMsgEventsMaxCount
	}
	return parseSessionMsgEventsMaxCount(d.ingestConfigValue(context.Background(), "session_message_events_max_count"))
}
