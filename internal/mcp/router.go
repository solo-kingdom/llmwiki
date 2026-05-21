package mcp

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// EventRecorder records MCP observability events (ingest job events / activity).
type EventRecorder interface {
	RecordMCP(step, phase, message string, payload map[string]any)
}

// Router routes tools/list and tools/call across configured servers.
type Router struct {
	registry *Registry
	recorder EventRecorder
}

// NewRouter creates a router from a registry.
func NewRouter(registry *Registry, recorder EventRecorder) *Router {
	return &Router{registry: registry, recorder: recorder}
}

// HasJobServers reports whether any job-scoped MCP servers are configured.
func (r *Router) HasJobServers() bool {
	if r == nil || r.registry == nil {
		return false
	}
	return len(r.registry.JobServers()) > 0
}

// HasChatServers reports whether any chat-scoped MCP servers are configured.
func (r *Router) HasChatServers() bool {
	if r == nil || r.registry == nil {
		return false
	}
	return len(r.registry.ChatServers()) > 0
}

// ListToolsForJob returns policy-filtered tools from all job servers.
func (r *Router) ListToolsForJob(ctx context.Context) ([]Tool, string, error) {
	if r == nil || r.registry == nil {
		return nil, "", nil
	}
	cfg := r.registry.Config()
	servers := r.registry.JobServers()
	var all []Tool
	var lastErr error
	for _, srv := range servers {
		r.record("mcp", "mcp_tools_list_started", "listing tools", map[string]any{"server_id": srv.ID})
		tools, err := r.listToolsOnServer(ctx, cfg, srv)
		if err != nil {
			lastErr = err
			r.record("mcp", "mcp_tools_list_failed", err.Error(), map[string]any{"server_id": srv.ID})
			continue
		}
		r.record("mcp", "mcp_tools_list_completed", "tools listed", map[string]any{
			"server_id": srv.ID, "count": len(tools),
		})
		all = append(all, tools...)
	}
	if len(all) == 0 && lastErr != nil {
		return nil, "", lastErr
	}
	return dedupeTools(all), "", nil
}

// ListToolsForChat returns policy-filtered tools from chat-scoped servers.
func (r *Router) ListToolsForChat(ctx context.Context) ([]Tool, string, error) {
	if r == nil || r.registry == nil {
		return nil, "", nil
	}
	cfg := r.registry.Config()
	servers := r.registry.ChatServers()
	var all []Tool
	var lastErr error
	for _, srv := range servers {
		tools, err := r.listToolsOnServer(ctx, cfg, srv)
		if err != nil {
			lastErr = err
			continue
		}
		all = append(all, tools...)
	}
	if len(all) == 0 && lastErr != nil {
		return nil, "", lastErr
	}
	return dedupeTools(all), "", nil
}

// ChatToolAllowed reports whether a tool is allowed on any chat server.
func (r *Router) ChatToolAllowed(toolName string) (bool, error) {
	if r == nil || r.registry == nil {
		return false, nil
	}
	cfg := r.registry.Config()
	for _, srv := range r.registry.ChatServers() {
		if IsToolCallAllowed(cfg, &srv, toolName) {
			return true, nil
		}
	}
	return false, nil
}

// CallToolForChat invokes a tool on chat-scoped servers with failover.
func (r *Router) CallToolForChat(ctx context.Context, toolName string, args map[string]interface{}) (result string, localOnly bool, err error) {
	if r == nil || r.registry == nil {
		return "", true, nil
	}
	cfg := r.registry.Config()
	servers := r.registry.ChatServers()
	if len(servers) == 0 {
		return "", true, nil
	}
	var lastErr error
	for _, srv := range servers {
		if !IsToolCallAllowed(cfg, &srv, toolName) {
			lastErr = fmt.Errorf("tool %q not allowed on server %q", toolName, srv.ID)
			continue
		}
		out, callErr := r.callOnServer(ctx, cfg, srv, toolName, args)
		if callErr == nil {
			return out, false, nil
		}
		lastErr = callErr
	}
	return "", true, lastErr
}

func (r *Router) listToolsOnServer(ctx context.Context, cfg *Config, srv ServerConfig) ([]Tool, error) {
	var lastErr error
	max := srv.Retry.Max + 1
	if max < 1 {
		max = 1
	}
	for attempt := 0; attempt < max; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(srv.Retry.BackoffMS) * time.Millisecond)
		}
		tr, err := NewTransport(srv)
		if err != nil {
			lastErr = err
			continue
		}
		tools, err := tr.ListTools(ctx)
		_ = tr.Close()
		if err != nil {
			lastErr = err
			continue
		}
		return FilterTools(tools, cfg, &srv), nil
	}
	return nil, lastErr
}

// CallTool invokes a tool with retry and server failover. Returns localOnly=true when degraded.
func (r *Router) CallTool(ctx context.Context, toolName string, args map[string]interface{}) (result string, localOnly bool, err error) {
	if r == nil || r.registry == nil {
		return "", true, nil
	}
	cfg := r.registry.Config()
	servers := r.registry.JobServers()
	if len(servers) == 0 {
		return "", true, nil
	}

	var lastErr error
	for _, srv := range servers {
		if !IsToolCallAllowed(cfg, &srv, toolName) {
			lastErr = fmt.Errorf("tool %q not allowed on server %q", toolName, srv.ID)
			continue
		}
		r.record("mcp", "mcp_tool_call_started", "calling tool", map[string]any{
			"server_id": srv.ID, "tool": toolName,
		})
		out, callErr := r.callOnServer(ctx, cfg, srv, toolName, args)
		if callErr == nil {
			r.record("mcp", "mcp_tool_call_completed", "tool call ok", map[string]any{
				"server_id": srv.ID, "tool": toolName,
			})
			return out, false, nil
		}
		lastErr = callErr
		r.record("mcp", "mcp_tool_call_failed", callErr.Error(), map[string]any{
			"server_id": srv.ID, "tool": toolName,
		})
	}

	r.record("mcp", "mcp_degraded", "all MCP servers failed; falling back to local_only", map[string]any{
		"tool": toolName, "error": errString(lastErr),
	})
	r.record("mcp", "mcp_fallback_local_only", "disabled tool calls for remainder", nil)
	return "", true, lastErr
}

func (r *Router) callOnServer(ctx context.Context, cfg *Config, srv ServerConfig, toolName string, args map[string]interface{}) (string, error) {
	max := srv.Retry.Max + 1
	if max < 1 {
		max = 1
	}
	var lastErr error
	for attempt := 0; attempt < max; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(srv.Retry.BackoffMS) * time.Millisecond)
		}
		tr, err := NewTransport(srv)
		if err != nil {
			lastErr = err
			continue
		}
		if !IsToolCallAllowed(cfg, &srv, toolName) {
			_ = tr.Close()
			return "", fmt.Errorf("tool %q not allowed", toolName)
		}
		out, err := tr.CallTool(ctx, toolName, args)
		_ = tr.Close()
		if err != nil {
			lastErr = err
			continue
		}
		return out, nil
	}
	return "", lastErr
}

func (r *Router) record(step, phase, message string, payload map[string]any) {
	if r == nil || r.recorder == nil {
		return
	}
	r.recorder.RecordMCP(step, phase, message, payload)
}

func dedupeTools(tools []Tool) []Tool {
	seen := make(map[string]bool)
	var out []Tool
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

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
