package activity

import (
	"testing"
)

func TestSanitizeRemoteAddr(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"192.168.1.100:12345", "192.168.*.*"},
		{"10.0.0.1:8080", "10.0.*.*"},
		{"127.0.0.1:3000", "127.0.*.*"},
		{"192.168.1.1", "192.168.*.*"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeRemoteAddr(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeRemoteAddr(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestSanitizeDetails_RemovesSensitiveKeys(t *testing.T) {
	details := map[string]interface{}{
		"tool":         "search",
		"duration_ms":  150,
		"authorization": "Bearer secret-token-12345",
		"token":        "should-be-removed",
		"api_key":      "should-be-removed",
		"password":     "should-be-removed",
		"bearer":       "should-be-removed",
		"nested": map[string]interface{}{
			"authorization": "nested-secret",
			"safe_key":      "kept",
		},
	}

	sanitized := SanitizeDetails(details)

	if _, ok := sanitized["authorization"]; ok {
		t.Error("authorization should be sanitized")
	}
	if _, ok := sanitized["token"]; ok {
		t.Error("token should be sanitized")
	}
	if _, ok := sanitized["api_key"]; ok {
		t.Error("api_key should be sanitized")
	}
	if _, ok := sanitized["password"]; ok {
		t.Error("password should be sanitized")
	}
	if _, ok := sanitized["bearer"]; ok {
		t.Error("bearer should be sanitized")
	}
	if v, ok := sanitized["tool"]; !ok || v != "search" {
		t.Error("tool should be preserved")
	}
	if v, ok := sanitized["duration_ms"]; !ok || v != 150 {
		t.Error("duration_ms should be preserved")
	}

	nested, ok := sanitized["nested"].(map[string]interface{})
	if !ok {
		t.Fatal("nested should be preserved")
	}
	if _, ok := nested["authorization"]; ok {
		t.Error("nested authorization should be sanitized")
	}
	if v, ok := nested["safe_key"]; !ok || v != "kept" {
		t.Error("nested safe_key should be preserved")
	}
}

func TestSanitizeDetails_RemovesRequestBodyAndArguments(t *testing.T) {
	details := map[string]interface{}{
		"tool":          "search",
		"request_body":  "full request body here",
		"arguments":     map[string]interface{}{"query": "secret data"},
		"tool_result":   "full result here",
	}

	sanitized := SanitizeDetails(details)

	if _, ok := sanitized["request_body"]; ok {
		t.Error("request_body should be sanitized")
	}
	if _, ok := sanitized["arguments"]; ok {
		t.Error("arguments should be sanitized")
	}
	if _, ok := sanitized["tool_result"]; ok {
		t.Error("tool_result should be sanitized")
	}
	if _, ok := sanitized["tool"]; !ok {
		t.Error("tool should be preserved")
	}
}
