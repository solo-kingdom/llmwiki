package ingest

import (
	"context"
	"encoding/json"
	"sync/atomic"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// mcpRecorderAdapter bridges mcp.EventRecorder to JobRecorder and activity logs.
type mcpRecorderAdapter struct {
	jobRec JobRecorder
	db     *sqlite.DB
}

func (a *mcpRecorderAdapter) RecordMCP(step, phase, message string, payload map[string]any) {
	if a.jobRec != nil {
		a.jobRec.Record(step, phase, message, SanitizePayload(payload))
	}
	if a.db != nil && (phase == "mcp_degraded" || phase == "mcp_fallback_local_only") {
		activity.Record(a.db, activity.Entry{
			Level:    "warn",
			Category: "mcp",
			Action:   phase,
			Message:  message,
			Status:   "degraded",
			Details:  sanitizeActivityDetails(payload),
			Source:   "ingest",
		})
	}
}

func sanitizeActivityDetails(payload map[string]any) map[string]interface{} {
	if payload == nil {
		return nil
	}
	out := make(map[string]interface{}, len(payload))
	for k, v := range payload {
		out[k] = v
	}
	return out
}

// pipelineMCPExecutor implements llm.ToolExecutor using the MCP router.
type pipelineMCPExecutor struct {
	router    *mcp.Router
	localOnly atomic.Bool
}

func newPipelineMCPExecutor(router *mcp.Router) *pipelineMCPExecutor {
	return &pipelineMCPExecutor{router: router}
}

func (e *pipelineMCPExecutor) LocalOnly() bool {
	return e == nil || e.localOnly.Load()
}

func (e *pipelineMCPExecutor) ListTools(ctx context.Context) ([]llm.ToolDefinition, error) {
	if e == nil || e.router == nil || e.LocalOnly() {
		return nil, nil
	}
	tools, _, err := e.router.ListToolsForJob(ctx)
	if err != nil {
		e.localOnly.Store(true)
		return nil, err
	}
	out := make([]llm.ToolDefinition, 0, len(tools))
	for _, t := range tools {
		out = append(out, llm.ToolDefinition{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.InputSchema,
		})
	}
	return out, nil
}

func (e *pipelineMCPExecutor) Execute(ctx context.Context, name string, argsJSON string) (string, error) {
	if e == nil || e.router == nil || e.LocalOnly() {
		return "", nil
	}
	var args map[string]interface{}
	if argsJSON != "" {
		_ = json.Unmarshal([]byte(argsJSON), &args)
	}
	result, localOnly, err := e.router.CallTool(ctx, name, args)
	if localOnly {
		e.localOnly.Store(true)
	}
	if err != nil && result == "" {
		return "", err
	}
	return result, nil
}
