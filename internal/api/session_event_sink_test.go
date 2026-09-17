package api

import (
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/agentruntime"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestSSEEventSinkTokenPersistsFullContent(t *testing.T) {
	api, _ := setupTestAPI(t)
	session := &sqlite.IngestSession{Title: "sink"}
	if err := api.db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	message := &sqlite.IngestSessionMessage{SessionID: session.ID, Role: "assistant", Content: "", StreamStatus: "streaming"}
	if err := api.db.CreateIngestSessionMessage(message); err != nil {
		t.Fatalf("CreateIngestSessionMessage: %v", err)
	}
	sink := newSSEEventSink(func(string, interface{}) {}, api.db, message.ID, nil)
	sink.Token("1234567890123456789012345678901234567890")
	content := sink.Flush()
	got, _ := api.db.GetIngestSessionMessage(message.ID)
	if got.Content != content || content == "" {
		t.Fatalf("persisted content=%q want %q", got.Content, content)
	}
}

func TestSSEEventSinkThoughtAndPermission(t *testing.T) {
	api, _ := setupTestAPI(t)
	session := &sqlite.IngestSession{Title: "sink"}
	if err := api.db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	message := &sqlite.IngestSessionMessage{SessionID: session.ID, Role: "assistant", Content: "body", StreamStatus: "streaming"}
	if err := api.db.CreateIngestSessionMessage(message); err != nil {
		t.Fatalf("CreateIngestSessionMessage: %v", err)
	}
	var events []string
	recorder := ingest.NewSessionMessageRecorder(api.db, message.ID)
	sink := newSSEEventSink(func(name string, _ interface{}) { events = append(events, name) }, api.db, message.ID, recorder)
	sink.Thought("thinking")
	sink.Permission(agentruntime.PermissionDecision{Allowed: false, Reason: "policy_denied", ToolKind: "execute"})
	got, _ := api.db.GetIngestSessionMessage(message.ID)
	if got.Content != "body" {
		t.Fatalf("thought changed content: %q", got.Content)
	}
	storedEvents, _ := api.db.ListSessionMessageEvents(message.ID, 100)
	if len(storedEvents) < 2 {
		t.Fatalf("expected thought/permission events, got %+v", storedEvents)
	}
	if strings.Join(events, ",") != "thought,permission" {
		t.Fatalf("SSE events = %v", events)
	}
	logs, err := api.db.ListActivityLogs(sqlite.ActivityLogListFilter{Category: "agent", Limit: 10})
	if err != nil {
		t.Fatalf("ListActivityLogs: %v", err)
	}
	if len(logs) != 1 || logs[0].Action != "acp_permission" {
		t.Fatalf("permission activity logs = %+v", logs)
	}
}

func TestSSEEventSinkToolPayloads(t *testing.T) {
	api, _ := setupTestAPI(t)
	var payloads []map[string]string
	sink := newSSEEventSink(func(name string, payload interface{}) {
		if p, ok := payload.(map[string]string); ok {
			payloads = append(payloads, p)
		}
	}, api.db, "", nil)
	sink.ToolStart("read", "detail-a")
	sink.ToolDone("read", "detail-b")
	if len(payloads) != 2 || payloads[0]["tool"] != "read" || payloads[1]["detail"] != "detail-b" {
		t.Fatalf("payloads = %+v", payloads)
	}
}
