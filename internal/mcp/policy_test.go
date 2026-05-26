package mcp

import "testing"

func TestFilterToolsReadonlyDefault(t *testing.T) {
	cfg := DefaultConfig()
	srv := ServerConfig{AllowedTools: nil}
	tools := []Tool{
		{Name: "search"}, {Name: "read"}, {Name: "create"},
	}
	out := FilterTools(tools, cfg, &srv)
	if len(out) != 2 {
		t.Fatalf("got %d tools, want 2", len(out))
	}
}

func TestIsToolCallAllowedWriteBlocked(t *testing.T) {
	cfg := DefaultConfig()
	srv := ServerConfig{AllowedTools: []string{"search", "read"}}
	if IsToolCallAllowed(cfg, &srv, "create") {
		t.Error("create should be blocked")
	}
	if !IsToolCallAllowed(cfg, &srv, "search") {
		t.Error("search should be allowed")
	}
}
