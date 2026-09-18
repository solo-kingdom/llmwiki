package acp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func fakeAgentConfig(t *testing.T, behavior string, extraEnv ...string) AgentConfig {
	t.Helper()
	t.Setenv("FAKE_ACP_BEHAVIOR", behavior)
	passthrough := append([]string{"PATH", "FAKE_ACP_BEHAVIOR"}, extraEnv...)
	raw, err := json.Marshal(map[string]any{
		"version": 1,
		"agents": map[string]any{
			"fake": map[string]any{
				"id":              "fake",
				"name":            "Fake",
				"enabled":         true,
				"command":         buildFakeAgent(t),
				"env_passthrough": passthrough,
				"permission":      map[string]any{"mode": "auto"},
			},
		},
		"defaults": map[string]any{"readonly_only": true, "on_unavailable": "error"},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	cfg, err := ParseConfig(string(raw))
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	return cfg.Agents["fake"]
}

func TestManagerReuseInvalidateAndClose(t *testing.T) {
	cfg := fakeAgentConfig(t, "message")
	mgr := NewManager(2)
	first, err := mgr.Acquire(context.Background(), "s1", cfg, t.TempDir())
	if err != nil {
		t.Fatalf("Acquire first: %v", err)
	}
	again, err := mgr.Acquire(context.Background(), "s1", cfg, t.TempDir())
	if err != nil {
		t.Fatalf("Acquire again: %v", err)
	}
	if first != again {
		t.Fatal("Manager did not reuse connection")
	}
	mgr.Invalidate("s1")
	replacement, err := mgr.Acquire(context.Background(), "s1", cfg, t.TempDir())
	if err != nil {
		t.Fatalf("Acquire replacement: %v", err)
	}
	if replacement == first {
		t.Fatal("Invalidate did not replace connection")
	}
	mgr.CloseAll()
	if len(mgr.conns) != 0 {
		t.Fatalf("CloseAll left %d connections", len(mgr.conns))
	}
}

func TestManagerConcurrentLimit(t *testing.T) {
	cfg := fakeAgentConfig(t, "message")
	mgr := NewManager(1)
	if _, err := mgr.Acquire(context.Background(), "s1", cfg, t.TempDir()); err != nil {
		t.Fatalf("Acquire first: %v", err)
	}
	if _, err := mgr.Acquire(context.Background(), "s2", cfg, t.TempDir()); !errors.Is(err, ErrTooManyAgents) {
		t.Fatalf("Acquire second error = %v, want ErrTooManyAgents", err)
	}
	mgr.CloseAll()
}
