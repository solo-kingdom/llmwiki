package acp

import "testing"

func TestSanitizeText(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"key sk-abcdefghijklmnop", "key ***"},
		{"Authorization: Bearer abc.def", "Authorization: ***"},
		{"token ghp_abcdefghijklmnop", "token ***"},
		{"token xoxb-1234567890", "token ***"},
	}
	for _, tt := range tests {
		if got := SanitizeText(tt.input); got != tt.want {
			t.Errorf("SanitizeText(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
	for _, plain := range []string{"sk-short", "bearer", "ordinary text"} {
		if got := SanitizeText(plain); got != plain {
			t.Errorf("SanitizeText(%q) = %q, want unchanged", plain, got)
		}
	}
}
