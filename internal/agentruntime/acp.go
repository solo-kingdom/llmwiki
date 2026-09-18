package agentruntime

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/acp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type acpRuntime struct {
	mgr       *acp.Manager
	workspace string
	cfg       acp.Config
	agent     acp.AgentConfig
}

func newACPRuntime(mgr *acp.Manager, workspace string, cfg acp.Config, agent acp.AgentConfig) *acpRuntime {
	return &acpRuntime{mgr: mgr, workspace: workspace, cfg: cfg, agent: agent}
}

func (r *acpRuntime) Kind() string  { return KindACP }
func (r *acpRuntime) Label() string { return "acp / " + r.agent.Name }

func (r *acpRuntime) Prompt(ctx context.Context, req PromptRequest, sink EventSink) (PromptResult, error) {
	if sink == nil {
		return PromptResult{}, fmt.Errorf("event sink is nil")
	}
	cwd, err := acp.ResolveCWD(r.workspace, req.SessionID, r.agent.CWDPolicy)
	if err != nil {
		return PromptResult{}, err
	}
	timeout := r.agent.PromptTimeoutMS
	if timeout <= 0 {
		timeout = acp.DefaultPromptTimeoutMS
	}
	promptCtx, cancelPrompt := context.WithTimeout(ctx, time.Duration(timeout)*time.Millisecond)
	defer cancelPrompt()
	conn, err := r.mgr.Acquire(promptCtx, req.SessionID, r.agent, cwd)
	if err != nil {
		return PromptResult{}, err
	}
	promptText := req.UserContent
	if !conn.HistoryReplayed && len(req.History) > 0 {
		promptText = renderACPHistory(req.History, req.UserContent)
		conn.HistoryReplayed = true
		sink.Debug("acp_turn", "acp_history_replay", "ACP history guidance injected", map[string]any{
			"history_messages": len(req.History),
		})
	}

	tracker := &trackingSink{inner: sink}
	toolNames := map[string]string{}
	attempt := func(current *acp.Conn) (PromptResult, error) {
		permission := func(request acp.PermissionRequest) acp.PermissionDecision {
			if promptCtx.Err() != nil {
				return acp.CancelledDecision(request)
			}
			decision := acp.Decide(r.agent.Permission, r.cfg.Defaults.ReadonlyOnly, request)
			tracker.Permission(PermissionDecision{
				Outcome: decision.Outcome, OptionID: decision.OptionID, Allowed: decision.Allowed,
				Reason: decision.Reason, ToolKind: decision.ToolKind, ToolTitle: decision.ToolTitle,
			})
			return decision
		}
		stopReason, promptErr := current.Prompt(promptCtx, current.RemoteSessionID, promptText, acp.Handlers{
			OnEvent:      func(event acp.Event) { r.forwardEvent(sink, tracker, event, toolNames) },
			OnPermission: permission,
		})
		if stopReason != "" {
			sink.Debug("acp_turn", "acp_stop_reason", "ACP prompt stopped", map[string]any{"stop_reason": stopReason})
		}
		return PromptResult{StopReason: stopReason}, promptErr
	}

	result, err := attempt(conn)
	if err != nil && !tracker.hasToken && promptCtx.Err() == nil && !errors.Is(err, acp.ErrCancelTimeout) {
		sink.Debug("acp_turn", "acp_process_restart", "ACP process restarted after pre-token failure", map[string]any{
			"error": acp.SanitizeText(err.Error()),
		})
		r.mgr.Invalidate(req.SessionID)
		conn, acquireErr := r.mgr.Acquire(promptCtx, req.SessionID, r.agent, cwd)
		if acquireErr != nil {
			return PromptResult{}, acquireErr
		}
		if len(req.History) > 0 {
			conn.HistoryReplayed = true
			promptText = renderACPHistory(req.History, req.UserContent)
		}
		tracker = &trackingSink{inner: sink}
		result, err = attempt(conn)
	}
	if err != nil {
		if errors.Is(err, acp.ErrCancelTimeout) {
			r.mgr.Invalidate(req.SessionID)
		}
		if conn != nil {
			sink.Debug("acp_turn", "acp_process_exit", "ACP prompt failed", map[string]any{
				"error":       acp.SanitizeText(err.Error()),
				"stderr_tail": conn.StderrTail(),
			})
		}
		return PromptResult{Text: tracker.text.String(), StopReason: result.StopReason}, err
	}
	if errors.Is(promptCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
		return PromptResult{Text: tracker.text.String(), StopReason: result.StopReason}, fmt.Errorf("ACP prompt timeout: %w", context.DeadlineExceeded)
	}
	if ctx.Err() != nil {
		return PromptResult{Text: tracker.text.String(), StopReason: "cancelled"}, nil
	}
	return PromptResult{Text: tracker.text.String(), StopReason: result.StopReason}, nil
}

func (r *acpRuntime) forwardEvent(sink EventSink, tracker *trackingSink, event acp.Event, toolNames map[string]string) {
	switch event.Kind {
	case "message":
		if event.Text == "" {
			sink.Warning("acp_unsupported_content", "ACP agent sent an unsupported content block")
			sink.Debug("acp_turn", "agent_message_unsupported", "Unsupported ACP content block", map[string]any{"raw": event.Raw})
			return
		}
		tracker.Token(event.Text)
	case "thought":
		sink.Thought(event.Text)
	case "tool_call":
		name := event.ToolName
		if name == "" {
			name = event.ToolKind
		}
		detail := event.ToolTitle
		if detail == "" && len(event.ToolRawInput) > 0 {
			detail = string(event.ToolRawInput)
		}
		if event.ToolCallID != "" && name != "" {
			toolNames[event.ToolCallID] = name
		}
		sink.ToolStart(name, truncateACPDetail(detail))
	case "tool_call_update":
		detail := string(event.ToolRawOutput)
		name := event.ToolName
		if name == "" {
			name = toolNames[event.ToolCallID]
		}
		if event.ToolStatus == "completed" || event.ToolStatus == "failed" {
			sink.ToolDone(name, truncateACPDetail(detail))
		}
	case "plan":
		entries := make([]PlanEntry, 0, len(event.Plan))
		for _, entry := range event.Plan {
			entries = append(entries, PlanEntry{Content: entry.Content, Priority: entry.Priority, Status: entry.Status})
		}
		sink.Plan(entries)
	case "usage":
		sink.Debug("acp_turn", "acp_usage", "ACP usage update", event.Raw)
	case "user_echo":
		sink.Debug("acp_turn", "user_message_echo", "ACP user message echo", event.Raw)
	default:
		sink.Debug("acp_turn", "acp_update_ignored", "Unknown ACP update", event.Raw)
	}
}

type trackingSink struct {
	inner    EventSink
	text     strings.Builder
	hasToken bool
}

func (s *trackingSink) Token(text string) {
	if text == "" {
		return
	}
	s.hasToken = true
	s.text.WriteString(text)
	s.inner.Token(text)
}
func (s *trackingSink) Thought(text string)                    { s.inner.Thought(text) }
func (s *trackingSink) ToolStart(name, detail string)          { s.inner.ToolStart(name, detail) }
func (s *trackingSink) ToolDone(name, detail string)           { s.inner.ToolDone(name, detail) }
func (s *trackingSink) Plan(entries []PlanEntry)               { s.inner.Plan(entries) }
func (s *trackingSink) Permission(decision PermissionDecision) { s.inner.Permission(decision) }
func (s *trackingSink) Warning(code, message string)           { s.inner.Warning(code, message) }
func (s *trackingSink) Debug(step, phase, message string, payload map[string]any) {
	s.inner.Debug(step, phase, message, payload)
}

func renderACPHistory(history []sqlite.IngestSessionMessage, current string) string {
	type rendered struct {
		role    string
		content string
	}
	items := make([]rendered, 0, len(history))
	for _, message := range history {
		if message.StreamStatus == "streaming" || message.Role == "system" {
			continue
		}
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		items = append(items, rendered{role: message.Role, content: content})
	}
	if len(items) > 47 {
		items = items[len(items)-47:]
	}
	var builder strings.Builder
	if len(items) > 0 {
		builder.WriteString("以下是 llmwiki 会话历史，用于恢复上下文。\n\n")
		for _, item := range items {
			if item.role == "user" {
				builder.WriteString("## User\n")
			} else {
				builder.WriteString("## Assistant\n")
			}
			builder.WriteString(item.content)
			builder.WriteString("\n\n")
		}
	}
	builder.WriteString("## User\n")
	builder.WriteString(current)
	return builder.String()
}

func truncateACPDetail(detail string) string {
	detail = acp.SanitizeText(strings.TrimSpace(detail))
	const maxRunes = 500
	runes := []rune(detail)
	if len(runes) <= maxRunes {
		return detail
	}
	return string(runes[:maxRunes]) + "…"
}
