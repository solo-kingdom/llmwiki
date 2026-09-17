package acp

import (
	"strings"
	"testing"
)

func TestEnvPassthroughNameValidation(t *testing.T) {
	for _, tc := range []struct {
		name string
		env  string
	}{
		{"bad start", `["1BAD"]`},
		{"empty", `[""]`},
		{"duplicate", `["PATH","PATH"]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","env_passthrough":` + tc.env + `}},"defaults":{}}`
			_, err := ParseConfig(raw)
			if err == nil {
				t.Fatal("expected error")
			}
			if ve, ok := err.(*ValidationError); !ok || !strings.HasPrefix(ve.Path, "agents.x.env_passthrough[") {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestCredentialEnvironmentNamesAccepted(t *testing.T) {
	raw := `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","env_passthrough":["SOME_PROVIDER_API_KEY","GITHUB_TOKEN"]}},"defaults":{}}`
	if _, err := ParseConfig(raw); err != nil {
		t.Fatalf("credential env names rejected: %v", err)
	}
}

func TestArgsCredentialValidation(t *testing.T) {
	bad := []string{
		`["--token"]`,
		`["--api-key=sk-xxxxxxxx"]`,
		`["Bearer abc"]`,
		`["Authorization: x"]`,
		`["ghp_abcdefghijklmnop"]`,
		`["github_pat_abcdefghijklmnop"]`,
		`["xoxb-abcdefghijklmnop"]`,
		`["xoxp-abcdefghijklmnop"]`,
		`["AKIAABCDEFGHIJKLMNOP"]`,
		`["eyJhbGciOiJIUzI1NiJ9.payload.signature"]`,
		`["--api-key","opaque-value"]`,
	}
	for _, args := range bad {
		t.Run(args, func(t *testing.T) {
			raw := `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","args":` + args + `}},"defaults":{}}`
			_, err := ParseConfig(raw)
			if err == nil {
				t.Fatal("expected credential error")
			}
			ve, ok := err.(*ValidationError)
			if !ok || !strings.HasPrefix(ve.Path, "agents.x.args[") {
				t.Fatalf("unexpected error: %v", err)
			}
			if !strings.Contains(ve.Message, "env_passthrough") {
				t.Fatalf("error does not guide to env_passthrough: %v", err)
			}
		})
	}
}

func TestArgsNormalParametersAccepted(t *testing.T) {
	raw := `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"npx","args":["-y","some-acp-adapter","--acp","--verbose"]}},"defaults":{}}`
	if _, err := ParseConfig(raw); err != nil {
		t.Fatalf("normal args rejected: %v", err)
	}
}

func TestRemovedEnvFieldRejected(t *testing.T) {
	raw := `{"version":1,"agents":{"x":{"id":"x","name":"X","command":"agent","env":{"SOME_KEY":"secret"}}},"defaults":{}}`
	_, err := ParseConfig(raw)
	if err == nil {
		t.Fatal("expected env field error")
	}
	ve, ok := err.(*ValidationError)
	if !ok || ve.Path != "agents.x.env" {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(ve.Message, "env_passthrough") {
		t.Fatalf("error does not guide to env_passthrough: %v", err)
	}
}
