package agentruntime

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type nativeRuntime struct {
	db        *sqlite.DB
	workspace string
	session   *sqlite.IngestSession
	client    *llm.Client
	model     string
}

func newNativeRuntime(db *sqlite.DB, workspace string, session *sqlite.IngestSession) (*nativeRuntime, error) {
	if session == nil {
		return nil, fmt.Errorf("%w: session is nil", ErrNoProviderInstance)
	}
	instanceID := session.LLMInstanceID
	model := session.LLMModel
	if instanceID == "" {
		instanceID, _ = db.GetConfig("last_instance_id")
	}
	if model == "" {
		model, _ = db.GetConfig("last_model")
	}
	client, err := llm.ClientFromInstance(db, instanceID, model)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNoProviderInstance, err)
	}
	return &nativeRuntime{db: db, workspace: workspace, session: session, client: client, model: model}, nil
}

func (r *nativeRuntime) Kind() string { return KindNative }
func (r *nativeRuntime) Label() string {
	return "native / " + r.model
}

func (r *nativeRuntime) Prompt(ctx context.Context, req PromptRequest, sink EventSink) (PromptResult, error) {
	if sink == nil {
		return PromptResult{}, fmt.Errorf("event sink is nil")
	}
	displayContent := req.DisplayUserContent
	if displayContent == "" {
		displayContent = req.UserContent
	}
	resolver := &ingest.ContextResolver{DB: r.db, Workspace: r.workspace}
	subset, err := resolver.ResolveRelatedSubset(displayContent, req.WikiRefs)
	if err != nil {
		log.Printf("[agentruntime] subset resolve failed session=%s: %v", req.SessionID, err)
	}
	subsetSection := ingest.FormatRelatedSubsetSection(req.DocLang, subset)
	step := ingest.PromptStepForMode(req.Mode)
	messages := ingest.AssembleIngestChatMessages(
		req.History, req.UserContent, req.DocLang, r.workspace,
		ingest.ResolveRulesSupplement(r.db), subsetSection, step,
	)
	if len(messages) > 0 {
		sink.Debug("compose", "system_prompt", "System prompt assembled", map[string]any{
			"system_prompt": truncateDebug(messages[0].Content, 32*1024),
			"total_chars":   len(messages[0].Content),
			"message_count": len(messages),
			"model":         r.model,
		})
	}

	router := sessionChatRouter(r.db)
	onToolRead := func(documentID, relativePath, title string) {
		ingest.RecordToolReadReference(r.db, req.SessionID, documentID, relativePath, title)
	}
	executor := ingest.NewChatWikiExecutor(r.workspace, r.db, req.SessionID, router, req.Mode, onToolRead)
	tools, _ := executor.ListTools(ctx)
	cfg := mcp.ToolLoopConfigForModeFromStore(req.Mode, r.db)
	temp := mcp.ToolTemperatureForMode(req.Mode)
	tokens := mcp.ToolMaxTokensForMode(req.Mode)
	finalText, err := ingest.RunSessionChatToolLoop(
		ctx, r.client, executor, messages, tools, temp, tokens, cfg,
		func(phase, toolName, detail string) {
			if phase == "start" {
				sink.ToolStart(toolName, detail)
				return
			}
			sink.ToolDone(toolName, detail)
		},
		req.Mode, req.Recorder,
	)
	if err != nil {
		sink.Warning("tool_loop_failed", err.Error())
		if req.Recorder != nil {
			req.Recorder.Record("fallback", "tool_loop_failed", "Tool loop failed, falling back to direct stream", map[string]any{"error": err.Error()})
		}
		cleaned := ingest.StripToolMessages(messages)
		ch, streamErr := r.client.StreamChat(ctx, cleaned, 0.7, 2048)
		if streamErr != nil {
			return PromptResult{}, streamErr
		}
		var builder strings.Builder
		for event := range ch {
			switch event.Type {
			case "token":
				builder.WriteString(event.Content)
				sink.Token(event.Content)
			case "error":
				if event.Error != nil {
					return PromptResult{}, event.Error
				}
				return PromptResult{}, fmt.Errorf("LLM stream failed")
			}
		}
		if ctx.Err() != nil {
			return PromptResult{}, ctx.Err()
		}
		text := builder.String()
		return PromptResult{Text: text, StopReason: "end_turn"}, nil
	}
	if finalText != "" {
		sink.Token(finalText)
	}
	return PromptResult{Text: finalText, StopReason: "end_turn"}, nil
}

func sessionChatRouter(db *sqlite.DB) *mcp.Router {
	raw, _ := db.GetConfig("mcp_servers_json")
	reg, err := mcp.NewRegistry(raw)
	if err != nil {
		return nil
	}
	return mcp.NewRouter(reg, nil)
}

func truncateDebug(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…(truncated)"
}
