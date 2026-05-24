package ingest

import (
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// SessionMessageRecorder records prompt debug events for a chat session message.
type SessionMessageRecorder struct {
	db        *sqlite.DB
	messageID string
	maxN      int
}

// NewSessionMessageRecorder creates a recorder for the given message.
// All methods are nil-safe: a nil recorder is a no-op.
func NewSessionMessageRecorder(db *sqlite.DB, messageID string) *SessionMessageRecorder {
	maxN := sqlite.DefaultSessionMsgEventsMaxCount
	if db != nil {
		maxN = db.GetSessionMsgEventsMaxCount()
	}
	return &SessionMessageRecorder{db: db, messageID: messageID, maxN: maxN}
}

// Record writes a debug event for the message. Nil-safe and error-tolerant.
func (r *SessionMessageRecorder) Record(step, phase, message string, payload map[string]any) {
	if r == nil || r.db == nil || r.messageID == "" {
		return
	}
	safe := SanitizePayload(payload)
	_ = r.db.InsertSessionMessageEvent(r.messageID, step, phase, message, safe, r.maxN)
}
