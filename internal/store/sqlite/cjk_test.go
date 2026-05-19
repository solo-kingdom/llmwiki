package sqlite

import (
	"testing"
)

func TestHasCJK(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"hello", false},
		{"hello world", false},
		{"中文", true},
		{"日本語", true},
		{"한국어", true},
		{"hello 中文 world", true},
		{"", false},
		{"123", false},
	}

	for _, tt := range tests {
		got := hasCJK(tt.input)
		if got != tt.want {
			t.Errorf("hasCJK(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestSearchChunksCJKFallback(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "cjk-fallback.md", "/wiki", "wiki/cjk-fallback.md")

	chunks := []Chunk{
		{ChunkIndex: 0, Content: "这是一段中文测试文本，用于验证全文搜索功能", TokenCount: 10},
		{ChunkIndex: 1, Content: "日本語のテストデータです", TokenCount: 8},
		{ChunkIndex: 2, Content: "Regular English text without CJK characters", TokenCount: 7},
	}
	if err := db.StoreChunks(doc.ID, chunks); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	results, err := db.SearchChunks("中文测试", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() CJK error = %v", err)
	}
	if len(results) == 0 {
		t.Error("expected CJK LIKE fallback results, got none")
	} else {
		t.Logf("CJK LIKE fallback returned %d results", len(results))
	}
}

func TestSearchChunksCJKNoFallbackForASCII(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "ascii-only.md", "/wiki", "wiki/ascii-only.md")
	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "Regular English text about databases", TokenCount: 7},
	}); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	results, err := db.SearchChunks("nonexistentterm", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected no results for non-CJK query with no match, got %d", len(results))
	}
}
