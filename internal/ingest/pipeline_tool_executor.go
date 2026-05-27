package ingest

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// PipelineToolExecutor provides local search/read tools for the ingest pipeline,
// combining them with optional external MCP tools. Local tools are always available
// when a DB is present; external MCP tools are appended when configured.
type PipelineToolExecutor struct {
	workspace string
	db        *sqlite.DB
	mcpExec   *pipelineMCPExecutor
}

// NewPipelineToolExecutor creates a tool executor with local tools and optional MCP.
func NewPipelineToolExecutor(workspace string, db *sqlite.DB, mcpExec *pipelineMCPExecutor) *PipelineToolExecutor {
	return &PipelineToolExecutor{
		workspace: workspace,
		db:        db,
		mcpExec:   mcpExec,
	}
}

// ListTools returns local search/read definitions plus any external MCP tools.
func (e *PipelineToolExecutor) ListTools(ctx context.Context) ([]llm.ToolDefinition, error) {
	var tools []llm.ToolDefinition

	// Local tools: always available when db is present
	if e.db != nil {
		for _, t := range mcp.BuiltinReadonlyToolDefinitions() {
			tools = append(tools, llm.ToolDefinition{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.InputSchema,
			})
		}
	}

	// External MCP tools (optional)
	if e.mcpExec != nil && !e.mcpExec.LocalOnly() {
		mcpTools, err := e.mcpExec.ListTools(ctx)
		if err == nil {
			tools = append(tools, mcpTools...)
		}
	}

	return dedupePipelineTools(tools), nil
}

// Execute dispatches tool calls: local tools first, then external MCP.
func (e *PipelineToolExecutor) Execute(ctx context.Context, name string, argsJSON string) (string, error) {
	name = strings.TrimSpace(name)

	// Local tools: search and read
	if isLocalReadonlyTool(name) {
		if e.db == nil {
			return "Error: database not connected", nil
		}
		var args map[string]interface{}
		if argsJSON != "" {
			_ = json.Unmarshal([]byte(argsJSON), &args)
		}
		return mcp.ExecuteLocalReadonlyTool(e.workspace, e.db, name, args)
	}

	// External MCP fallback
	if e.mcpExec != nil {
		out, err := e.mcpExec.Execute(ctx, name, argsJSON)
		if err != nil {
			return "", err
		}
		return out, nil
	}

	return "", nil
}

// isLocalReadonlyTool reports whether a tool name should be handled locally.
func isLocalReadonlyTool(name string) bool {
	switch strings.ToLower(name) {
	case mcp.DefaultToolSearch, mcp.DefaultToolRead, mcp.DefaultToolWebFetch:
		return true
	default:
		return false
	}
}

// dedupePipelineTools removes duplicate tool definitions by name (case-insensitive).
func dedupePipelineTools(tools []llm.ToolDefinition) []llm.ToolDefinition {
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
