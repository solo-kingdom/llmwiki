package sqlite

import (
	"testing"
)

// createTestSessionMessage creates a session + assistant message for FK tests.
func createTestSessionMessage(t *testing.T, db *DB) *IngestSessionMessage {
	t.Helper()
	session := &IngestSession{Title: "test session"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	msg := &IngestSessionMessage{
		SessionID:    session.ID,
		Role:         "assistant",
		Content:      "test",
		StreamStatus: "complete",
	}
	if err := db.CreateIngestSessionMessage(msg); err != nil {
		t.Fatalf("CreateIngestSessionMessage: %v", err)
	}
	return msg
}

func TestInsertAndListSessionMessageEvents(t *testing.T) {
	db := openTestDB(t)
	msg := createTestSessionMessage(t, db)

	events := []struct {
		step    string
		phase   string
		message string
		payload map[string]any
	}{
		{"compose", "system_prompt", "System prompt assembled", map[string]any{"total_chars": 1200}},
		{"compose", "messages_snapshot", "Messages assembled", map[string]any{"total_messages": 5}},
		{"round_0", "llm_request", "Round 0 LLM request", map[string]any{"model": "gpt-4o", "temperature": 0.7}},
		{"round_0", "llm_response", "Round 0 LLM response", map[string]any{"content_preview": "Hello"}},
		{"round_0", "tool_result", "read executed", map[string]any{"tool_name": "read", "duration_ms": 150}},
	}

	for _, ev := range events {
		if err := db.InsertSessionMessageEvent(msg.ID, ev.step, ev.phase, ev.message, ev.payload, 100); err != nil {
			t.Fatalf("InsertSessionMessageEvent(%s/%s): %v", ev.step, ev.phase, err)
		}
	}

	got, err := db.ListSessionMessageEvents(msg.ID, 50)
	if err != nil {
		t.Fatalf("ListSessionMessageEvents: %v", err)
	}
	if len(got) != len(events) {
		t.Fatalf("expected %d events, got %d", len(events), len(got))
	}
	for i, ev := range got {
		if ev.Step != events[i].step {
			t.Errorf("event[%d].Step = %q, want %q", i, ev.Step, events[i].step)
		}
		if ev.Phase != events[i].phase {
			t.Errorf("event[%d].Phase = %q, want %q", i, ev.Phase, events[i].phase)
		}
		if ev.Message != events[i].message {
			t.Errorf("event[%d].Message = %q, want %q", i, ev.Message, events[i].message)
		}
		if ev.MessageID != msg.ID {
			t.Errorf("event[%d].MessageID = %q, want %q", i, ev.MessageID, msg.ID)
		}
	}
}

func TestTrimSessionMessageEvents(t *testing.T) {
	db := openTestDB(t)
	msg := createTestSessionMessage(t, db)
	maxCount := 3

	for i := 0; i < 5; i++ {
		if err := db.InsertSessionMessageEvent(msg.ID, "round", "test", "event", map[string]any{"i": i}, maxCount); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}

	got, err := db.ListSessionMessageEvents(msg.ID, 50)
	if err != nil {
		t.Fatalf("ListSessionMessageEvents: %v", err)
	}
	if len(got) != maxCount {
		t.Fatalf("expected %d events after trim, got %d", maxCount, len(got))
	}
}

func TestParseSessionMsgEventsMaxCount(t *testing.T) {
	tests := []struct {
		input string
		want  int
		err   bool
	}{
		{"", DefaultSessionMsgEventsMaxCount, false},
		{"100", 100, false},
		{"10", 10, false},
		{"500", 500, false},
		{"9", 0, true},   // below min
		{"501", 0, true}, // above max
		{"abc", 0, true},
	}
	for _, tt := range tests {
		got, err := ParseSessionMsgEventsMaxCount(tt.input)
		if tt.err {
			if err == nil {
				t.Errorf("ParseSessionMsgEventsMaxCount(%q) expected error", tt.input)
			}
		} else {
			if err != nil {
				t.Errorf("ParseSessionMsgEventsMaxCount(%q) unexpected error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Errorf("ParseSessionMsgEventsMaxCount(%q) = %d, want %d", tt.input, got, tt.want)
			}
		}
	}
}
