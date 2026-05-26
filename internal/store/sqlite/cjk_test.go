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

func TestEscapeFTSQueryTrigram(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"machine learning", "machine learning"},
		{"中文测试", "中文测试"},
		{`foo"bar*baz`, "foobarbaz"},
		{"  spaced  ", "spaced"},
	}
	for _, tt := range tests {
		got := escapeFTSQuery(tt.in)
		if got != tt.want {
			t.Errorf("escapeFTSQuery(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestSearchChunksCJKViaFTS(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "cjk-fts.md", "/wiki", "wiki/cjk-fts.md")

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
		t.Fatal("expected CJK FTS results, got none")
	}
	if results[0].Score == 0 {
		t.Fatal("expected BM25-ranked FTS result (non-zero score), got LIKE fallback score 0")
	}
}

func TestSearchChunksCJKShortQueryLIKEFallback(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "cjk-fallback.md", "/wiki", "wiki/cjk-fallback.md")
	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "这是一段中文测试文本，用于验证全文搜索功能", TokenCount: 10},
	}); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	results, err := db.SearchChunks("中文", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected results for short CJK query via LIKE fallback")
	}
}

func TestSearchChunksMixedQuery(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "mixed.md", "/wiki", "wiki/mixed.md")
	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "Transformer 注意力机制在 NLP 中很重要", TokenCount: 12},
	}); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	results, err := db.SearchChunks("注意力机制", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected mixed CJK query results")
	}
}

func TestSearchChunksEnglishRegression(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "english.md", "/wiki", "wiki/english.md")
	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "Machine learning models process natural language efficiently", TokenCount: 8},
	}); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	results, err := db.SearchChunks("machine learning", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected English FTS results")
	}
	if results[0].Score == 0 {
		t.Fatal("expected BM25-ranked FTS result for English query")
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
		t.Errorf("expected no results for non-matching query, got %d", len(results))
	}
}
