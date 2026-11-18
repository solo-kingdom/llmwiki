package postgres_test

import (
	"context"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestIngestSessionCRUD(t *testing.T) {
	db := pgtest.Open(t)

	session := &store.IngestSession{Title: "  hello  "}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	if session.ID == "" || session.Status != "active" || session.Mode != "ingest" || session.AgentKind != "native" {
		t.Fatalf("unexpected session defaults: %+v", session)
	}
	if session.Title != "hello" {
		t.Fatalf("title = %q, want trimmed hello", session.Title)
	}

	n, err := db.CountIngestSessions()
	if err != nil || n != 1 {
		t.Fatalf("CountIngestSessions = %d, err %v", n, err)
	}

	if err := db.UpdateIngestSessionTitle(session.ID, " new title "); err != nil {
		t.Fatalf("UpdateIngestSessionTitle: %v", err)
	}
	if err := db.UpdateIngestSessionStatus(session.ID, "archived"); err != nil {
		t.Fatalf("UpdateIngestSessionStatus: %v", err)
	}
	if err := db.UpdateIngestSessionMode(session.ID, "qa"); err != nil {
		t.Fatalf("UpdateIngestSessionMode: %v", err)
	}
	if err := db.UpdateIngestSessionAgent(session.ID, "acp", "agent-a"); err != nil {
		t.Fatalf("UpdateIngestSessionAgent: %v", err)
	}
	if err := db.UpdateIngestSessionLLM(session.ID, "inst-1", "model-x"); err != nil {
		t.Fatalf("UpdateIngestSessionLLM: %v", err)
	}
	if err := db.UpdateIngestSessionStoragePath(session.ID, "/tmp/storage"); err != nil {
		t.Fatalf("UpdateIngestSessionStoragePath: %v", err)
	}

	got, err := db.GetIngestSession(session.ID)
	if err != nil {
		t.Fatalf("GetIngestSession: %v", err)
	}
	if got.Title != "new title" || got.Status != "archived" || got.Mode != "qa" ||
		got.AgentKind != "acp" || got.ACPAgentID != "agent-a" ||
		got.LLMInstanceID != "inst-1" || got.LLMModel != "model-x" || got.StoragePath != "/tmp/storage" {
		t.Fatalf("unexpected session after updates: %+v", got)
	}

	sessions, err := db.ListIngestSessions()
	if err != nil || len(sessions) != 1 {
		t.Fatalf("ListIngestSessions = %d, err %v", len(sessions), err)
	}

	if missing, err := db.GetIngestSession("missing"); err != nil || missing != nil {
		t.Fatalf("missing session = %+v, err %v", missing, err)
	}

	bad := &store.IngestSession{Title: "bad", AgentKind: "bogus"}
	if err := db.CreateIngestSession(bad); err == nil {
		t.Fatal("expected invalid agent_kind error")
	}

	if err := db.DeleteIngestSession(session.ID); err != nil {
		t.Fatalf("DeleteIngestSession: %v", err)
	}
	if err := db.DeleteIngestSession(session.ID); err == nil {
		t.Fatal("expected session not found error")
	}
}

func TestIngestSessionMessages(t *testing.T) {
	db := pgtest.Open(t)

	session := &store.IngestSession{Title: "chat"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}

	userMsg := &store.IngestSessionMessage{SessionID: session.ID, Role: "user", Content: "hi"}
	if err := db.CreateIngestSessionMessage(userMsg); err != nil {
		t.Fatalf("CreateIngestSessionMessage user: %v", err)
	}
	if userMsg.ID == "" || userMsg.MessageType != "text" || userMsg.StreamStatus != "complete" || userMsg.WikiRefsJSON != "[]" {
		t.Fatalf("unexpected user message defaults: %+v", userMsg)
	}

	assistant := &store.IngestSessionMessage{
		SessionID: session.ID, Role: "assistant", Content: "hello",
		WikiRefsJSON: `["wiki/a.md"]`, ExcludeFromArchive: true,
	}
	if err := db.CreateIngestSessionMessage(assistant); err != nil {
		t.Fatalf("CreateIngestSessionMessage assistant: %v", err)
	}

	n, err := db.CountUserSessionMessages(session.ID)
	if err != nil || n != 1 {
		t.Fatalf("CountUserSessionMessages = %d, err %v", n, err)
	}

	msgs, err := db.ListIngestSessionMessages(session.ID)
	if err != nil || len(msgs) != 2 {
		t.Fatalf("ListIngestSessionMessages = %d, err %v", len(msgs), err)
	}

	got, err := db.GetIngestSessionMessage(assistant.ID)
	if err != nil {
		t.Fatalf("GetIngestSessionMessage: %v", err)
	}
	if got == nil || got.WikiRefsJSON != `["wiki/a.md"]` || !got.ExcludeFromArchive {
		t.Fatalf("unexpected assistant message: %+v", got)
	}

	if err := db.UpdateIngestSessionMessageContent(assistant.ID, "updated", "incomplete"); err != nil {
		t.Fatalf("UpdateIngestSessionMessageContent: %v", err)
	}
	if err := db.UpdateIngestSessionMessageExclude(assistant.ID, false); err != nil {
		t.Fatalf("UpdateIngestSessionMessageExclude: %v", err)
	}
	got, _ = db.GetIngestSessionMessage(assistant.ID)
	if got.Content != "updated" || got.StreamStatus != "incomplete" || got.ExcludeFromArchive {
		t.Fatalf("message not updated: %+v", got)
	}

	if missing, err := db.GetIngestSessionMessage("missing"); err != nil || missing != nil {
		t.Fatalf("missing message = %+v, err %v", missing, err)
	}
	if err := db.CreateIngestSessionMessage(&store.IngestSessionMessage{SessionID: session.ID}); err == nil {
		t.Fatal("expected role required error")
	}
}

func TestSessionReferences(t *testing.T) {
	db := pgtest.Open(t)

	session := &store.IngestSession{Title: "refs"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}

	if err := db.UpsertSessionReference(session.ID, "doc-1", "wiki/a.md", "Alpha", store.SessionRefSourceUserMention); err != nil {
		t.Fatalf("UpsertSessionReference user_mention: %v", err)
	}
	if err := db.UpsertSessionReference(session.ID, "doc-1", "wiki/a.md", "Alpha", store.SessionRefSourceToolRead); err != nil {
		t.Fatalf("UpsertSessionReference tool_read: %v", err)
	}

	n, err := db.CountSessionReference(session.ID, "doc-1")
	if err != nil || n != 1 {
		t.Fatalf("CountSessionReference = %d, err %v", n, err)
	}

	refs, err := db.ListSessionReferences(session.ID)
	if err != nil || len(refs) != 1 {
		t.Fatalf("ListSessionReferences = %d, err %v", len(refs), err)
	}
	if refs[0].Source != store.SessionRefSourceUserMention {
		t.Fatalf("source = %q, want user_mention to win", refs[0].Source)
	}
	if refs[0].FirstSeenAt == "" {
		t.Fatal("expected first_seen_at")
	}

	if err := db.UpsertSessionReference(session.ID, "doc-1", "wiki/a.md", "Alpha", "invalid"); err == nil {
		t.Fatal("expected invalid reference source error")
	}
	if err := db.UpsertSessionReference("", "doc-1", "wiki/a.md", "Alpha", store.SessionRefSourceToolRead); err == nil {
		t.Fatal("expected session_id required error")
	}

	empty, err := db.ListSessionReferences("no-session")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty refs = %d, err %v", len(empty), err)
	}
}

func TestSessionMessageEventsTrimAndRetention(t *testing.T) {
	db := pgtest.Open(t)

	// session_message_events is defined by the shared schema; skip until it lands.
	var hasTable bool
	if err := db.Pool().QueryRow(context.Background(),
		`SELECT to_regclass('session_message_events') IS NOT NULL`).Scan(&hasTable); err != nil {
		t.Fatalf("check session_message_events table: %v", err)
	}
	if !hasTable {
		t.Skip("session_message_events table missing from postgres schema")
	}

	session := &store.IngestSession{Title: "events"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	msg := &store.IngestSessionMessage{SessionID: session.ID, Role: "assistant", Content: "x"}
	if err := db.CreateIngestSessionMessage(msg); err != nil {
		t.Fatalf("CreateIngestSessionMessage: %v", err)
	}

	for i := 0; i < 5; i++ {
		if err := db.InsertSessionMessageEvent(msg.ID, "round_0", "llm_request", "msg", map[string]any{"i": i}, 3); err != nil {
			t.Fatalf("InsertSessionMessageEvent #%d: %v", i, err)
		}
	}
	events, err := db.ListSessionMessageEvents(msg.ID, 10)
	if err != nil || len(events) != 3 {
		t.Fatalf("events = %d, err %v", len(events), err)
	}
	if events[0].MessageID != msg.ID || events[0].Step != "round_0" {
		t.Fatalf("unexpected events: %+v", events)
	}

	if err := db.TrimSessionMessageEvents(msg.ID, 1); err != nil {
		t.Fatalf("TrimSessionMessageEvents: %v", err)
	}
	events, _ = db.ListSessionMessageEvents(msg.ID, 10)
	if len(events) != 1 {
		t.Fatalf("after trim events = %d, want 1", len(events))
	}
}

func TestSessionMsgEventsMaxCount(t *testing.T) {
	db := pgtest.Open(t)

	if got := db.GetSessionMsgEventsMaxCount(); got != store.DefaultSessionMsgEventsMaxCount {
		t.Fatalf("default = %d, want %d", got, store.DefaultSessionMsgEventsMaxCount)
	}
	setConfig(t, db, "session_message_events_max_count", "20")
	if got := db.GetSessionMsgEventsMaxCount(); got != 20 {
		t.Fatalf("configured = %d, want 20", got)
	}
	setConfig(t, db, "session_message_events_max_count", "1")
	if got := db.GetSessionMsgEventsMaxCount(); got != store.MinSessionMsgEventsMaxCount {
		t.Fatalf("clamped min = %d, want %d", got, store.MinSessionMsgEventsMaxCount)
	}
	setConfig(t, db, "session_message_events_max_count", "9999")
	if got := db.GetSessionMsgEventsMaxCount(); got != store.MaxSessionMsgEventsMaxCount {
		t.Fatalf("clamped max = %d, want %d", got, store.MaxSessionMsgEventsMaxCount)
	}
}
