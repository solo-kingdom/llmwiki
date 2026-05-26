package vcs

import (
	"testing"
)

func TestSplitWikiContent(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantFM  string
		wantBody string
		wantHas bool
	}{
		{
			name:     "no frontmatter",
			input:    "# Hello\nWorld",
			wantFM:   "",
			wantBody: "# Hello\nWorld",
			wantHas:  false,
		},
		{
			name:     "with frontmatter",
			input:    "---\ntitle: Test\ntags: [a]\n---\n# Hello\nWorld",
			wantFM:   "title: Test\ntags: [a]",
			wantBody: "# Hello\nWorld",
			wantHas:  true,
		},
		{
			name:     "empty frontmatter",
			input:    "---\n---\nBody only",
			wantFM:   "",
			wantBody: "Body only",
			wantHas:  true,
		},
		{
			name:     "empty content",
			input:    "",
			wantFM:   "",
			wantBody: "",
			wantHas:  false,
		},
		{
			name:     "only dashes not frontmatter",
			input:    "---\nno closing dashes",
			wantFM:   "",
			wantBody: "---\nno closing dashes",
			wantHas:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fm, body, hasFM := splitWikiContent(tt.input)
			if fm != tt.wantFM {
				t.Errorf("fm = %q, want %q", fm, tt.wantFM)
			}
			if body != tt.wantBody {
				t.Errorf("body = %q, want %q", body, tt.wantBody)
			}
			if hasFM != tt.wantHas {
				t.Errorf("hasFM = %v, want %v", hasFM, tt.wantHas)
			}
		})
	}
}

func TestLLMMergeConflictEdgeCases(t *testing.T) {
	ctx := t.Context()
	mc := &MergeConflictContext{} // nil LLM client

	// Both empty
	result, err := llmMergeConflict(ctx, mc, "test.md", "", "")
	if err != nil {
		t.Fatalf("both empty: %v", err)
	}
	if result != "" {
		t.Errorf("both empty: got %q, want empty", result)
	}

	// One empty
	result, err = llmMergeConflict(ctx, mc, "test.md", "", "theirs")
	if err != nil {
		t.Fatalf("ours empty: %v", err)
	}
	if result != "theirs" {
		t.Errorf("ours empty: got %q, want %q", result, "theirs")
	}

	result, err = llmMergeConflict(ctx, mc, "test.md", "ours", "")
	if err != nil {
		t.Fatalf("theirs empty: %v", err)
	}
	if result != "ours" {
		t.Errorf("theirs empty: got %q, want %q", result, "ours")
	}

	// Identical
	result, err = llmMergeConflict(ctx, mc, "test.md", "same", "same")
	if err != nil {
		t.Fatalf("identical: %v", err)
	}
	if result != "same" {
		t.Errorf("identical: got %q, want %q", result, "same")
	}

	// Different content without LLM should error
	_, err = llmMergeConflict(ctx, mc, "test.md", "ours content", "theirs content")
	if err == nil {
		t.Error("expected error without LLM client")
	}
}
