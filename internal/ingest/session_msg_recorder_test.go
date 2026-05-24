package ingest

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestSessionMessageRecorderNilSafe(t *testing.T) {
	// nil recorder should not panic
	var r *SessionMessageRecorder
	r.Record("compose", "system_prompt", "test", map[string]any{"key": "value"})
}

func TestSessionMessageRecorderRecords(t *testing.T) {
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	// Create session + message for FK
	session := &sqlite.IngestSession{Title: "recorder test"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	msg := &sqlite.IngestSessionMessage{
		SessionID:    session.ID,
		Role:         "assistant",
		Content:      "test",
		StreamStatus: "complete",
	}
	if err := db.CreateIngestSessionMessage(msg); err != nil {
		t.Fatalf("CreateIngestSessionMessage: %v", err)
	}

	r := NewSessionMessageRecorder(db, msg.ID)
	r.Record("compose", "system_prompt", "System prompt assembled", map[string]any{
		"total_chars": 1200,
		"api_key":     "secret-key-should-be-removed",
	})

	events, err := db.ListSessionMessageEvents(msg.ID, 10)
	if err != nil {
		t.Fatalf("ListSessionMessageEvents: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	ev := events[0]
	if ev.Step != "compose" {
		t.Errorf("Step = %q, want %q", ev.Step, "compose")
	}
	if ev.Phase != "system_prompt" {
		t.Errorf("Phase = %q, want %q", ev.Phase, "system_prompt")
	}
	// Verify api_key was sanitized out
	if ev.Payload != "" {
		if containsStr(ev.Payload, "secret-key") {
			t.Errorf("Payload should not contain api_key, got: %s", ev.Payload)
		}
		if !containsStr(ev.Payload, "total_chars") {
			t.Errorf("Payload should contain total_chars, got: %s", ev.Payload)
		}
	}
}


