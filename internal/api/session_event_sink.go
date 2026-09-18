package api

import (
	"strings"
	"sync"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/agentruntime"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type sseEventSink struct {
	sendEvent      func(string, interface{})
	db             *sqlite.DB
	assistantMsgID string
	recorder       *ingest.SessionMessageRecorder

	mu          sync.Mutex
	content     strings.Builder
	lastFlush   time.Time
	lastFlushAt int
}

func newSSEEventSink(sendEvent func(string, interface{}), db *sqlite.DB, assistantMsgID string, recorder *ingest.SessionMessageRecorder) *sseEventSink {
	return &sseEventSink{sendEvent: sendEvent, db: db, assistantMsgID: assistantMsgID, recorder: recorder, lastFlush: time.Now()}
}

func (s *sseEventSink) Token(text string) {
	if text == "" {
		return
	}
	s.mu.Lock()
	s.content.WriteString(text)
	content := s.content.String()
	shouldFlush := len(content)-s.lastFlushAt >= 32 || time.Since(s.lastFlush) >= 300*time.Millisecond
	if shouldFlush {
		s.lastFlush = time.Now()
		s.lastFlushAt = len(content)
	}
	s.mu.Unlock()
	if shouldFlush {
		if s.db != nil && s.assistantMsgID != "" {
			_ = s.db.UpdateIngestSessionMessageContent(s.assistantMsgID, content, "streaming")
		}
	}
	s.send("token", map[string]string{"content": text})
}

func (s *sseEventSink) Flush() string {
	s.mu.Lock()
	content := s.content.String()
	s.lastFlushAt = len(content)
	s.lastFlush = time.Now()
	s.mu.Unlock()
	if s.db != nil && s.assistantMsgID != "" {
		_ = s.db.UpdateIngestSessionMessageContent(s.assistantMsgID, content, "streaming")
	}
	return content
}

func (s *sseEventSink) Content() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.content.String()
}

func (s *sseEventSink) Thought(text string) {
	s.send("thought", map[string]string{"content": text})
	s.record("acp_turn", "agent_thought", "ACP agent thought", map[string]any{"content": text})
}

func (s *sseEventSink) ToolStart(name, detail string) {
	s.send("tool_start", map[string]string{"tool": name, "detail": detail})
	s.record("acp_turn", "acp_tool_call", "ACP tool call started", map[string]any{"tool": name, "detail": detail})
}

func (s *sseEventSink) ToolDone(name, detail string) {
	s.send("tool_done", map[string]string{"tool": name, "detail": detail})
	s.record("acp_turn", "acp_tool_call_update", "ACP tool call completed", map[string]any{"tool": name, "detail": detail})
}

func (s *sseEventSink) Plan(entries []agentruntime.PlanEntry) {
	s.send("plan", map[string]any{"entries": entries})
	payload := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		payload = append(payload, map[string]any{"content": entry.Content, "priority": entry.Priority, "status": entry.Status})
	}
	s.record("acp_turn", "acp_plan", "ACP plan updated", map[string]any{"entries": payload})
}

func (s *sseEventSink) Permission(decision agentruntime.PermissionDecision) {
	s.send("permission", decision)
	s.record("acp_turn", "acp_permission", "ACP permission decided", map[string]any{
		"allowed": decision.Allowed, "reason": decision.Reason, "tool_kind": decision.ToolKind, "tool_title": decision.ToolTitle,
	})
	activity.RecordSync(s.db, activity.Entry{
		Level: "info", Category: "agent", Action: "acp_permission",
		Message: "ACP agent permission decision", ResourceType: "ingest_session", ResourceID: s.assistantMsgID,
		Status: "success", Source: "api", Details: map[string]interface{}{
			"allowed": decision.Allowed, "reason": decision.Reason, "tool_kind": decision.ToolKind,
		},
	})
}

func (s *sseEventSink) Warning(code, message string) {
	s.send("warning", map[string]string{"code": code, "message": message})
	s.record("acp_turn", code, message, nil)
}

func (s *sseEventSink) Debug(step, phase, message string, payload map[string]any) {
	s.record(step, phase, message, payload)
}

func (s *sseEventSink) send(event string, payload interface{}) {
	if s.sendEvent != nil {
		s.sendEvent(event, payload)
	}
}

func (s *sseEventSink) record(step, phase, message string, payload map[string]any) {
	if s.recorder != nil {
		s.recorder.Record(step, phase, message, payload)
	}
}
