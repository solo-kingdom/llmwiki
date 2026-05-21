package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

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
	workspace string
	db        *sqlite.DB
	sessionID string
	router    *mcp.Router
	onToolRead func(documentID, relativePath, title string)
}

func NewChatWikiExecutor(workspace string, db *sqlite.DB, sessionID string, router *mcp.Router, onToolRead func(string, string, string)) *ChatWikiExecutor {
	return &ChatWikiExecutor{
		workspace: workspace,
		db:        db,
		sessionID: sessionID,
		router:    router,
		onToolRead: onToolRead,
	}
}

func (e *ChatWikiExecutor) ListTools(ctx context.Context) ([]llm.ToolDefinition, error) {
	tools := make([]llm.ToolDefinition, 0, 8)
	for _, t := range mcp.BuiltinReadonlyToolDefinitions() {
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
		var result llm.ChatResult
		var err error
		if useTools {
			result, err = client.Chat(ctx, msgs, tools, temperature, maxTokens)
		} else {
			result, err = client.Chat(ctx, msgs, nil, temperature, maxTokens)
		}
		if err != nil {
			return "", err
		}
		if len(result.ToolCalls) == 0 {
			return result.Content, nil
		}
		if !useTools {
			return result.Content, nil
		}

		msgs = append(msgs, llm.Message{Role: "assistant", Content: result.Content})
		calls := result.ToolCalls
		if len(calls) > cfg.MaxToolCallsPerRound {
			calls = calls[:cfg.MaxToolCallsPerRound]
		}
		for _, tc := range calls {
			if onEvent != nil {
				onEvent("start", tc.Name, truncateForEvent(tc.Arguments, 200))
			}
			out, execErr := executor.Execute(ctx, tc.Name, tc.Arguments)
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
