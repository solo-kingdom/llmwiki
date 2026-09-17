package acp

import (
	"os"
	"strings"
	"testing"
)

func TestParseConfigEmptyDefaults(t *testing.T) {
	cfg, err := ParseConfig("")
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	if cfg.Version != ConfigVersion || len(cfg.Agents) != 0 {
		t.Fatalf("unexpected default config: %+v", cfg)
	}
	if !cfg.Defaults.ReadonlyOnly || cfg.Defaults.OnUnavailable != DefaultOnUnavailable {
		t.Fatalf("unexpected defaults: %+v", cfg.Defaults)
	}
}

func TestParseConfigValidationErrors(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		path     string
		contains string
	}{
		{"id mismatch", `{"version":1,"agents":{"x":{"id":"y","name":"X","command":"agent"}},"defaults":{}}`, "agents.x.id", "must match"},
		{"shell command", `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent;rm"}},"defaults":{}}`, "agents.x.command", "shell"},
		{"timeout bounds", `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","init_timeout_ms":999}},"defaults":{}}`, "agents.x.init_timeout_ms", "between"},
		{"ask mode", `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","permission":{"mode":"ask"}}},"defaults":{}}`, "agents.x.permission.mode", "auto"},
		{"readonly write", `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","permission":{"mode":"auto","allow_write":true}}},"defaults":{"readonly_only":true}}`, "agents.x.permission", "readonly_only"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseConfig(tt.raw)
			if err == nil {
				t.Fatal("expected error")
			}
			ve, ok := err.(*ValidationError)
			if !ok {
				t.Fatalf("error type = %T, want *ValidationError", err)
			}
			if ve.Path != tt.path {
				t.Fatalf("path = %q, want %q", ve.Path, tt.path)
			}
			if !strings.Contains(ve.Message, tt.contains) {
				t.Fatalf("message = %q, want contains %q", ve.Message, tt.contains)
			}
		})
	}
}

func TestRedactedAgentsDoesNotLeakEnvironmentValues(t *testing.T) {
	t.Setenv("SOME_PROVIDER_API_KEY", "sk-super-secret-value")
	cfg := &Config{
		Version: ConfigVersion,
		Agents: map[string]AgentConfig{
			"x": {ID: "x", Name: "X", Command: "agent", EnvPassthrough: []string{"SOME_PROVIDER_API_KEY"}},
		},
	}
	ApplyDefaultsAfterParse(cfg)
	redacted := RedactedAgents(cfg)
	if len(redacted) != 1 || len(redacted[0].EnvPassthrough) != 1 {
		t.Fatalf("unexpected redacted agents: %+v", redacted)
	}
	if !redacted[0].EnvPassthrough[0].Present || redacted[0].EnvPassthrough[0].Name != "SOME_PROVIDER_API_KEY" {
		t.Fatalf("unexpected env status: %+v", redacted[0].EnvPassthrough)
	}
	canonical, err := CanonicalJSON(cfg)
	if err != nil {
		t.Fatalf("CanonicalJSON: %v", err)
	}
	if strings.Contains(canonical, os.Getenv("SOME_PROVIDER_API_KEY")) {
		t.Fatal("canonical config leaked environment value")
	}
}

func TestCanonicalJSONIdempotent(t *testing.T) {
	cfg, err := ParseConfig(`{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","enabled":true}},"defaults":{}}`)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	first, err := CanonicalJSON(cfg)
	if err != nil {
		t.Fatalf("CanonicalJSON: %v", err)
	}
	parsed, err := ParseConfig(first)
	if err != nil {
		t.Fatalf("ParseConfig canonical: %v", err)
	}
	second, err := CanonicalJSON(parsed)
	if err != nil {
		t.Fatalf("CanonicalJSON second: %v", err)
	}
	if first != second {
		t.Fatalf("canonical JSON is not idempotent:\n%s\n---\n%s", first, second)
	}
}
