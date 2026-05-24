package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const maxSessionWikiRefs = 5

// WikiRefRequest is the API payload for user @ mentions.
type WikiRefRequest struct {
	DocumentID   string `json:"document_id"`
	RelativePath string `json:"relative_path"`
}

// ParseWikiRefRequests validates and normalizes wiki refs from the client.
func ParseWikiRefRequests(db *sqlite.DB, refs []WikiRefRequest) ([]WikiRefInput, error) {
	if len(refs) > maxSessionWikiRefs {
		return nil, fmt.Errorf("at most %d wiki_refs allowed", maxSessionWikiRefs)
	}
	out := make([]WikiRefInput, 0, len(refs))
	for _, ref := range refs {
		doc, err := db.GetWikiDocumentByID(strings.TrimSpace(ref.DocumentID))
		if err != nil {
			return nil, err
		}
		if doc == nil {
			return nil, fmt.Errorf("wiki document not found: %s", ref.DocumentID)
		}
		if rp := strings.TrimSpace(ref.RelativePath); rp != "" && rp != doc.RelativePath {
			return nil, fmt.Errorf("relative_path mismatch for document %s", ref.DocumentID)
		}
		out = append(out, WikiRefInput{
			DocumentID:   doc.ID,
			RelativePath: doc.RelativePath,
			Title:        doc.Title,
		})
	}
	return out, nil
}

// ChatWikiExecutor runs readonly wiki tools for session chat.
type ChatWikiExecutor struct {
	workspace  string
	db         *sqlite.DB
	sessionID  string
	router     *mcp.Router
	mode       string
	onToolRead func(documentID, relativePath, title string)
}

func NewChatWikiExecutor(workspace string, db *sqlite.DB, sessionID string, router *mcp.Router, mode string, onToolRead func(string, string, string)) *ChatWikiExecutor {
	return &ChatWikiExecutor{
		workspace:  workspace,
		db:         db,
		sessionID:  sessionID,
		router:     router,
		mode:       mode,
		onToolRead: onToolRead,
	}
}

func (e *ChatWikiExecutor) ListTools(ctx context.Context) ([]llm.ToolDefinition, error) {
	tools := make([]llm.ToolDefinition, 0, 12)
	for _, t := range mcp.BuiltinToolDefinitionsForMode(e.mode) {
		tools = append(tools, llm.ToolDefinition{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.InputSchema,
		})
	}
	if e.router != nil {
		remote, _, err := e.router.ListToolsForChat(ctx)
		if err == nil {
			for _, t := range remote {
				if mcp.IsWriteToolName(t.Name) {
					continue
				}
				tools = append(tools, llm.ToolDefinition{
					Name:        t.Name,
					Description: t.Description,
					Parameters:  t.InputSchema,
				})
			}
		}
	}
	return dedupeToolDefinitions(tools), nil
}

func (e *ChatWikiExecutor) Execute(ctx context.Context, name string, argsJSON string) (string, error) {
	name = strings.TrimSpace(name)
	if mcp.IsWriteToolName(name) {
		return "", fmt.Errorf("write tool %q is not allowed in session chat", name)
	}

	var args map[string]interface{}
	if argsJSON != "" {
		_ = json.Unmarshal([]byte(argsJSON), &args)
	}

	if e.router != nil && e.router.HasChatServers() {
		if allowed, _ := e.router.ChatToolAllowed(name); allowed {
			out, _, err := e.router.CallToolForChat(ctx, name, args)
			if err == nil && out != "" {
				e.maybeRecordRead(name, args, out)
				return out, nil
			}
		}
	}

	out, err := mcp.ExecuteLocalReadonlyTool(e.workspace, e.db, name, args)
	if err != nil {
		return "", err
	}
	e.maybeRecordRead(name, args, out)
	return out, nil
}

func (e *ChatWikiExecutor) maybeRecordRead(toolName string, args map[string]interface{}, _ string) {
	if e.onToolRead == nil || strings.ToLower(toolName) != "read" {
		return
	}
	path, _ := args["path"].(string)
	path = strings.TrimSpace(path)
	if path == "" || e.db == nil {
		return
	}
	doc, err := e.db.GetDocument(path)
	if err != nil || doc == nil {
		doc, err = e.db.FindDocumentByName(path)
	}
	if err != nil || doc == nil || doc.SourceKind != "wiki" {
		return
	}
	e.onToolRead(doc.ID, doc.RelativePath, doc.Title)
}

func dedupeToolDefinitions(tools []llm.ToolDefinition) []llm.ToolDefinition {
	seen := make(map[string]bool)
	out := make([]llm.ToolDefinition, 0, len(tools))
	for _, t := range tools {
		k := strings.ToLower(t.Name)
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, t)
	}
	return out
}

// ToolEventCallback receives session chat tool lifecycle events.
type ToolEventCallback func(phase, toolName, detail string)

// RunSessionChatToolLoop executes readonly tools until the model returns text.
func RunSessionChatToolLoop(
	ctx context.Context,
	client *llm.Client,
	executor llm.ToolExecutor,
	messages []llm.Message,
	tools []llm.ToolDefinition,
	temperature float64,
	maxTokens int,
	cfg llm.ToolLoopConfig,
	onEvent ToolEventCallback,
	mode string,
	recorder *SessionMessageRecorder,
) (string, error) {
	if client == nil {
		return "", fmt.Errorf("LLM client is nil")
	}
	if cfg.MaxRounds <= 0 {
		cfg = llm.ToolLoopConfig{MaxRounds: 4, MaxToolCallsPerRound: 4}
	}
	if cfg.MaxToolCallsPerRound <= 0 {
		cfg.MaxToolCallsPerRound = 4
	}

	msgs := append([]llm.Message(nil), messages...)
	useTools := len(tools) > 0 && executor != nil

	for round := 0; round < cfg.MaxRounds; round++ {
		stepName := fmt.Sprintf("round_%d", round)
		toolChoice := mcp.ToolChoiceForMode(mode, round)

		// Record LLM request
		if recorder != nil {
			recorder.Record(stepName, "llm_request", stepName+" LLM request", map[string]any{
				"messages":    messageSummaries(msgs),
				"tools_count": len(tools),
				"temperature": temperature,
				"max_tokens":  maxTokens,
				"tool_choice": toolChoice,
			})
		}

		var result llm.ChatResult
		var err error
		if useTools {
			result, err = client.Chat(ctx, msgs, tools, temperature, maxTokens, llm.ChatOptions{ToolChoice: toolChoice})
		} else {
			result, err = client.Chat(ctx, msgs, nil, temperature, maxTokens)
		}
		if err != nil {
			// Record LLM error to debug events before deciding whether to retry.
			if recorder != nil {
				recorder.Record(stepName, "llm_error", stepName+" LLM call failed", map[string]any{
					"error": err.Error(),
				})
			}
			// Fallback: if tool_choice="required" caused a 400, retry without it
			if toolChoice != "" && isBadRequestError(err) {
				if useTools {
					result, err = client.Chat(ctx, msgs, tools, temperature, maxTokens)
				} else {
					result, err = client.Chat(ctx, msgs, nil, temperature, maxTokens)
				}
				if err != nil {
					return "", err
				}
			} else {
				return "", err
			}
		}

		// Record LLM response
		if recorder != nil {
			recorder.Record(stepName, "llm_response", stepName+" LLM response", map[string]any{
				"content_preview":  truncateForEvent(result.Content, 500),
				"content_chars":    len(result.Content),
				"tool_calls_count": len(result.ToolCalls),
				"tool_calls":       toolCallSummaries(result.ToolCalls),
			})
		}

		if len(result.ToolCalls) == 0 {
			// organize mode round 0: retry once with a nudge if no tools called
			if mode == "organize" && round == 0 && useTools {
				msgs = append(msgs, llm.Message{Role: "assistant", Content: result.Content})
				msgs = append(msgs, llm.Message{Role: "user", Content: "请先调用 structure 和 audit 工具来诊断 wiki 的状况，然后再给出建议。"})
				result2, err2 := client.Chat(ctx, msgs, tools, temperature, maxTokens)
				if err2 != nil {
					return result.Content, nil
				}
				if len(result2.ToolCalls) == 0 {
					return result2.Content, nil
				}
				result = result2
			} else {
				return result.Content, nil
			}
		}
		if !useTools {
			return result.Content, nil
		}

		msgs = append(msgs, llm.Message{Role: "assistant", Content: result.Content, ToolCalls: result.ToolCalls})
		calls := result.ToolCalls
		if len(calls) > cfg.MaxToolCallsPerRound {
			calls = calls[:cfg.MaxToolCallsPerRound]
		}
		for _, tc := range calls {
			if onEvent != nil {
				onEvent("start", tc.Name, truncateForEvent(tc.Arguments, 200))
			}
			start := time.Now()
			out, execErr := executor.Execute(ctx, tc.Name, tc.Arguments)
			duration := time.Since(start)
			detail := "ok"
			if execErr != nil {
				out = fmt.Sprintf("tool error: %v", execErr)
				detail = out
			} else {
				detail = truncateForEvent(out, 120)
			}
			if onEvent != nil {
				onEvent("done", tc.Name, detail)
			}

			// Record tool result
			if recorder != nil {
				payload := map[string]any{
					"tool_name":    tc.Name,
					"arguments":    truncateForEvent(tc.Arguments, 2000),
					"result_chars": len(out),
					"duration_ms":  duration.Milliseconds(),
				}
				if execErr != nil {
					payload["error"] = execErr.Error()
				} else {
					payload["result_preview"] = truncateForEvent(out, 2000)
				}
				recorder.Record(stepName, "tool_result", tc.Name+" executed", payload)
			}

			msgs = append(msgs, llm.Message{
				Role:       "tool",
				Content:    out,
				ToolCallID: tc.ID,
				Name:       tc.Name,
			})
		}
	}
	return "", fmt.Errorf("tool loop exceeded max rounds (%d)", cfg.MaxRounds)
}

// messageSummaries returns lightweight summaries of messages for debug recording.
func messageSummaries(msgs []llm.Message) []map[string]any {
	out := make([]map[string]any, len(msgs))
	for i, m := range msgs {
		entry := map[string]any{
			"role":          m.Role,
			"content_chars": len(m.Content),
		}
		if len(m.ToolCalls) > 0 {
			entry["tool_calls"] = toolCallSummaries(m.ToolCalls)
		}
		if m.ToolCallID != "" {
			entry["tool_call_id"] = m.ToolCallID
		}
		if m.Name != "" {
			entry["name"] = m.Name
		}
		// Include content for system and short messages
		if m.Role == "system" || len(m.Content) <= 500 {
			entry["content"] = m.Content
		} else {
			entry["content_preview"] = truncateForEvent(m.Content, 300)
		}
		out[i] = entry
	}
	return out
}

// toolCallSummaries returns lightweight summaries of tool calls.
func toolCallSummaries(calls []llm.ToolCall) []map[string]any {
	out := make([]map[string]any, len(calls))
	for i, tc := range calls {
		out[i] = map[string]any{
			"id":        tc.ID,
			"name":      tc.Name,
			"arguments": truncateForEvent(tc.Arguments, 300),
		}
	}
	return out
}

// isBadRequestError checks if the error is an HTTP 400 from the LLM API.
func isBadRequestError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "HTTP 400") || strings.Contains(err.Error(), "bad request")
}

// StripToolMessages removes tool-role messages and tool_calls from assistant
// messages, producing a clean conversation history suitable for a plain
// (non-tool) LLM call. This is used when the tool loop fails and the system
// falls back to direct streaming — sending tool messages without tool
// definitions confuses some LLM providers.
func StripToolMessages(msgs []llm.Message) []llm.Message {
	var out []llm.Message
	for _, m := range msgs {
		switch m.Role {
		case "tool":
			// Skip tool-result messages entirely.
			continue
		case "assistant":
			// Keep content, strip tool_calls.
			if len(m.ToolCalls) > 0 {
				out = append(out, llm.Message{
					Role:    m.Role,
					Content: m.Content,
				})
			} else {
				out = append(out, m)
			}
		default:
			out = append(out, m)
		}
	}
	return out
}

func truncateForEvent(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func RecordSessionReferences(db *sqlite.DB, sessionID string, refs []WikiRefInput, source string) {
	if db == nil || sessionID == "" {
		return
	}
	for _, ref := range refs {
		_ = db.UpsertSessionReference(sessionID, ref.DocumentID, ref.RelativePath, ref.Title, source)
	}
}

func RecordToolReadReference(db *sqlite.DB, sessionID, documentID, relativePath, title string) {
	if db == nil || sessionID == "" || documentID == "" {
		return
	}
	_ = db.UpsertSessionReference(sessionID, documentID, relativePath, title, sqlite.SessionRefSourceToolRead)
}

func WikiRefsJSONFromInputs(refs []WikiRefInput) string {
	if len(refs) == 0 {
		return "[]"
	}
	type stored struct {
		DocumentID   string `json:"document_id"`
		RelativePath string `json:"relative_path"`
		Title        string `json:"title"`
	}
	out := make([]stored, 0, len(refs))
	for _, ref := range refs {
		out = append(out, stored{
			DocumentID:   ref.DocumentID,
			RelativePath: ref.RelativePath,
			Title:        ref.Title,
		})
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func WikiRefsFromStoredJSON(raw string) ([]WikiRefInput, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return nil, nil
	}
	var stored []struct {
		DocumentID   string `json:"document_id"`
		RelativePath string `json:"relative_path"`
		Title        string `json:"title"`
	}
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return nil, err
	}
	out := make([]WikiRefInput, 0, len(stored))
	for _, s := range stored {
		out = append(out, WikiRefInput{
			DocumentID:   s.DocumentID,
			RelativePath: s.RelativePath,
			Title:        s.Title,
		})
	}
	return out, nil
}
