package mcp

import (
	"testing"
)

func TestToolChoiceForMode(t *testing.T) {
	tests := []struct {
		mode     string
		round    int
		expected string
	}{
		{"organize", 0, "required"},
		{"organize", 1, ""},
		{"organize", 2, ""},
		{"qa", 0, ""},
		{"ingest", 0, ""},
		{"", 0, ""},
	}

	for _, tt := range tests {
		got := ToolChoiceForMode(tt.mode, tt.round)
		if got != tt.expected {
			t.Errorf("ToolChoiceForMode(%q, %d) = %q, want %q", tt.mode, tt.round, got, tt.expected)
		}
	}
}
