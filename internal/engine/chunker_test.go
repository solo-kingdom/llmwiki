package engine

import (
	"strings"
	"testing"
)

func TestEstimateTokens(t *testing.T) {
	tests := []struct {
		input    string
		minToken int
	}{
		{"hello", 1},
		{"", 1},
		{"this is a test sentence", 5},
		{strings.Repeat("a", 100), 25},
		{"中文文本", 1},
	}
	for _, tt := range tests {
		got := EstimateTokens(tt.input)
		if got < tt.minToken {
			t.Errorf("EstimateTokens(%q) = %d, want >= %d", tt.input, got, tt.minToken)
		}
	}
}

func TestChunkTextEmpty(t *testing.T) {
	cfg := DefaultChunkConfig()
	chunks := ChunkText("", 1, cfg)
	if chunks != nil {
		t.Errorf("expected nil for empty text, got %v", chunks)
	}
}

func TestChunkTextShort(t *testing.T) {
	cfg := ChunkConfig{ChunkSize: 512, ChunkOverlap: 128, MinTokens: 1}
	text := "This is a short paragraph that fits in one chunk."
	chunks := ChunkText(text, 1, cfg)
	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Page != 1 {
		t.Errorf("expected Page=1, got %d", chunks[0].Page)
	}
	if chunks[0].Index != 0 {
		t.Errorf("expected Index=0, got %d", chunks[0].Index)
	}
}

func TestChunkTextHeaders(t *testing.T) {
	cfg := DefaultChunkConfig()
	text := `# Introduction

Some introductory text about the topic.

## Details

Detailed information about the subject.

### Subsection

More details here.`

	chunks := ChunkText(text, 1, cfg)
	if len(chunks) == 0 {
		t.Fatal("expected at least 1 chunk")
	}

	// Check that header breadcrumbs are set
	for _, c := range chunks {
		t.Logf("Chunk %d: breadcrumb=%q, content=%q", c.Index, c.HeaderBreadcrumb, truncate(c.Content, 50))
	}

	// Find a chunk that has the "Introduction" breadcrumb
	hasIntro := false
	for _, c := range chunks {
		if strings.Contains(c.HeaderBreadcrumb, "Introduction") {
			hasIntro = true
			break
		}
	}
	if !hasIntro {
		t.Error("expected a chunk with 'Introduction' in breadcrumb")
	}
}

func TestChunkTextLarge(t *testing.T) {
	cfg := ChunkConfig{ChunkSize: 20, ChunkOverlap: 5, MinTokens: 2}

	// Create text that will need multiple chunks
	paragraphs := make([]string, 50)
	for i := 0; i < 50; i++ {
		paragraphs[i] = "This is paragraph number " + string(rune('A'+i%26)) + " with enough text to be meaningful."
	}
	text := strings.Join(paragraphs, "\n\n")

	chunks := ChunkText(text, 1, cfg)
	if len(chunks) < 2 {
		t.Errorf("expected multiple chunks for large text, got %d", len(chunks))
	}
}

func TestChunkTextCJK(t *testing.T) {
	cfg := ChunkConfig{ChunkSize: 512, ChunkOverlap: 128, MinTokens: 1}
	text := "这是一段中文文本。它包含多个句子，用于测试分块器对中文的支持。中文分句应该按句号、问号和感叹号进行分割。"

	chunks := ChunkText(text, 1, cfg)
	if len(chunks) == 0 {
		t.Fatal("expected at least 1 chunk for CJK text")
	}
	t.Logf("CJK chunks: %d", len(chunks))
}

func TestIsCJK(t *testing.T) {
	tests := []struct {
		r    rune
		want bool
	}{
		{'中', true},
		{'日', true},
		{'本', true},
		{'あ', true}, // Hiragana
		{'ア', true}, // Katakana
		{'a', false},
		{'Z', false},
		{'1', false},
		{' ', false},
	}
	for _, tt := range tests {
		got := IsCJK(tt.r)
		if got != tt.want {
			t.Errorf("IsCJK(%q) = %v, want %v", tt.r, got, tt.want)
		}
	}
}

func TestDefaultChunkConfig(t *testing.T) {
	cfg := DefaultChunkConfig()
	if cfg.ChunkSize != 512 {
		t.Errorf("expected ChunkSize=512, got %d", cfg.ChunkSize)
	}
	if cfg.ChunkOverlap != 128 {
		t.Errorf("expected ChunkOverlap=128, got %d", cfg.ChunkOverlap)
	}
	if cfg.MinTokens != 32 {
		t.Errorf("expected MinTokens=32, got %d", cfg.MinTokens)
	}
}

func TestChunkTextStartChar(t *testing.T) {
	cfg := ChunkConfig{ChunkSize: 512, ChunkOverlap: 128, MinTokens: 1}
	text := "First paragraph.\n\nSecond paragraph.\n\nThird paragraph here."
	chunks := ChunkText(text, 1, cfg)
	if len(chunks) == 0 {
		t.Fatal("expected at least 1 chunk")
	}
	// First chunk should start at 0
	if chunks[0].StartChar != 0 {
		t.Errorf("expected StartChar=0 for first chunk, got %d", chunks[0].StartChar)
	}
}

func TestSplitSentences(t *testing.T) {
	tests := []struct {
		input  string
		minLen int
	}{
		{"Hello world. How are you? Fine!", 3},
		{"这是第一句。这是第二句？这是第三句！", 3},
		{"No sentence ending", 1},
	}
	for _, tt := range tests {
		result := splitSentences(tt.input)
		if len(result) < tt.minLen {
			t.Errorf("splitSentences(%q) returned %d parts, want >= %d", tt.input, len(result), tt.minLen)
		}
	}
}

func TestSplitParagraphs(t *testing.T) {
	text := "Para 1\n\nPara 2\n\n\nPara 3"
	result := splitParagraphs(text)
	if len(result) != 3 {
		t.Errorf("expected 3 paragraphs, got %d: %v", len(result), result)
	}
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}
