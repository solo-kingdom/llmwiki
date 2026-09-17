package acp

import (
	"context"
	"testing"
)

func TestCheckAgentsStates(t *testing.T) {
	command := buildFakeAgent(t)
	cfg := &Config{Version: ConfigVersion, Agents: map[string]AgentConfig{
		"disabled": {ID: "disabled", Name: "Disabled", Enabled: false, Command: "missing"},
		"missing":  {ID: "missing", Name: "Missing", Enabled: true, Command: "definitely-missing-acp-cli"},
		"ok":       {ID: "ok", Name: "OK", Enabled: true, Command: command, EnvPassthrough: []string{"PATH", "FAKE_ACP_BEHAVIOR"}},
	}, Defaults: Defaults{ReadonlyOnly: true, OnUnavailable: DefaultOnUnavailable}}
	t.Setenv("FAKE_ACP_BEHAVIOR", "message")
	results := CheckAgents(context.Background(), cfg, t.TempDir())
	if len(results) != 3 {
		t.Fatalf("results = %d, want 3", len(results))
	}
	byID := map[string]AgentCheckResult{}
	for _, result := range results {
		byID[result.ID] = result
	}
	if byID["disabled"].Status != "disabled" {
		t.Fatalf("disabled = %+v", byID["disabled"])
	}
	if byID["missing"].Status != "error" || byID["missing"].Code != "cli_not_found" {
		t.Fatalf("missing = %+v", byID["missing"])
	}
	if byID["ok"].Status != "ok" || byID["ok"].AgentName != "fake-agent" || byID["ok"].ProtocolVersion != 1 {
		t.Fatalf("ok = %+v", byID["ok"])
	}
}

func TestAvailability(t *testing.T) {
	cfg := &Config{Agents: map[string]AgentConfig{
		"ok":      {ID: "ok", Command: buildFakeAgent(t)},
		"missing": {ID: "missing", Command: "definitely-missing-acp-cli"},
	}}
	availability := Availability(cfg)
	if !availability["ok"].Available {
		t.Fatalf("ok availability = %+v", availability["ok"])
	}
	if availability["missing"].Available || availability["missing"].Reason == "" {
		t.Fatalf("missing availability = %+v", availability["missing"])
	}
}
