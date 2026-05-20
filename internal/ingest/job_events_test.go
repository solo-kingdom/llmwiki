package ingest

import (
	"strings"
	"testing"
)

func TestSanitizePayloadRemovesSecrets(t *testing.T) {
	out := SanitizePayload(map[string]any{
		"api_key": "secret",
		"model":   "gpt-4o",
		"nested": map[string]any{
			"authorization": "Bearer x",
			"ok":            true,
		},
	})
	if _, ok := out["api_key"]; ok {
		t.Fatal("api_key should be removed")
	}
	if out["model"] != "gpt-4o" {
		t.Fatalf("model = %v", out["model"])
	}
	nested := out["nested"].(map[string]any)
	if _, ok := nested["authorization"]; ok {
		t.Fatal("authorization should be removed")
	}
}

func TestTruncatePreview(t *testing.T) {
	long := string(make([]byte, maxPayloadPreviewBytes+100))
	got := truncatePreview(long)
	if len(got) <= maxPayloadPreviewBytes+20 {
		// includes suffix
	}
	if !strings.Contains(got, "truncated") {
		t.Fatal("expected truncation marker")
	}
}
