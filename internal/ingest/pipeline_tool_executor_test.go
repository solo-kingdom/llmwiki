package ingest

import (
	"context"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func openPipelineTestDB(t *testing.T) *sqlite.DB {
	t.Helper()
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestPipelineToolExecutor_ListTools_LocalOnly(t *testing.T) {
	exec := NewPipelineToolExecutor("/tmp/test-workspace", nil, nil, "")
	tools, err := exec.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools error: %v", err)
	}
	// Without DB, local tools are not added
	if len(tools) != 0 {
		t.Errorf("expected 0 tools without db, got %d", len(tools))
	}
}

func TestPipelineToolExecutor_Execute_LocalSearch_NoDB(t *testing.T) {
	exec := NewPipelineToolExecutor("/tmp/test-workspace", nil, nil, "")
	result, err := exec.Execute(context.Background(), "search", `{"mode":"list"}`)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if result != "Error: database not connected" {
		t.Errorf("expected DB error, got: %s", result)
	}
}

func TestPipelineToolExecutor_Execute_LocalRead_NoDB(t *testing.T) {
	exec := NewPipelineToolExecutor("/tmp/test-workspace", nil, nil, "")
	result, err := exec.Execute(context.Background(), "read", `{"path":"test"}`)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if result != "Error: database not connected" {
		t.Errorf("expected DB error, got: %s", result)
	}
}

func TestPipelineToolExecutor_Execute_UnknownTool(t *testing.T) {
	exec := NewPipelineToolExecutor("/tmp/test-workspace", nil, nil, "")
	result, err := exec.Execute(context.Background(), "unknown_tool", `{}`)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if result != "" {
		t.Errorf("expected empty result for unknown tool, got: %s", result)
	}
}

func TestIsLocalPipelineTool(t *testing.T) {
	tests := []struct {
		name     string
		expected bool
	}{
		{"search", true},
		{"read", true},
		{"Search", true},
		{"READ", true},
		{"write", false},
		{"delete", false},
		{"audit", true},
		{"structure", true},
		{"references", true},
		{"gaps", true},
		{"similar", true},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isLocalPipelineTool(tt.name); got != tt.expected {
				t.Errorf("isLocalPipelineTool(%q) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}

func TestPipelineToolExecutor_ListTools_OrganizeMode(t *testing.T) {
	db := openPipelineTestDB(t)
	exec := NewPipelineToolExecutor(t.TempDir(), db, nil, "organize")
	tools, err := exec.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools error: %v", err)
	}
	names := make(map[string]bool)
	for _, tool := range tools {
		names[tool.Name] = true
	}
	for _, want := range []string{"search", "read", "structure", "audit", "gaps", "similar", "references"} {
		if !names[want] {
			t.Errorf("organize mode missing tool %q, got %v", want, names)
		}
	}
}

func TestPipelineToolExecutor_ListTools_QAMode(t *testing.T) {
	db := openPipelineTestDB(t)
	exec := NewPipelineToolExecutor(t.TempDir(), db, nil, "qa")
	tools, err := exec.ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools error: %v", err)
	}
	names := make(map[string]bool)
	for _, tool := range tools {
		names[tool.Name] = true
	}
	if !names["references"] {
		t.Errorf("qa mode missing references tool, got %v", names)
	}
	if names["structure"] {
		t.Errorf("qa mode should not include structure tool, got %v", names)
	}
}

func TestDedupePipelineTools(t *testing.T) {
	// Verify builtin definitions exist
	defs := mcp.BuiltinReadonlyToolDefinitions()
	if len(defs) < 2 {
		t.Fatalf("expected at least 2 builtin tools, got %d", len(defs))
	}
	// Verify tool names are search and read
	names := make(map[string]bool)
	for _, d := range defs {
		names[d.Name] = true
	}
	if !names["search"] || !names["read"] {
		t.Errorf("expected search and read tools, got: %v", names)
	}
}
