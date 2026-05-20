package sqlite

import (
	"testing"
)

func TestStoreChunks(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "chunked.md", "/wiki", "wiki/chunked.md")

	chunks := []Chunk{
		{ChunkIndex: 0, Content: "First chunk of text", Page: 1, StartChar: 0, TokenCount: 5, HeaderBreadcrumb: "Intro"},
		{ChunkIndex: 1, Content: "Second chunk of text", Page: 1, StartChar: 100, TokenCount: 5, HeaderBreadcrumb: "Details"},
		{ChunkIndex: 2, Content: "Third chunk of text", Page: 2, StartChar: 200, TokenCount: 5, HeaderBreadcrumb: ""},
	}

	if err := db.StoreChunks(doc.ID, chunks); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	// Verify chunks via direct query
	var count int
	err := db.DB().QueryRow("SELECT COUNT(*) FROM document_chunks WHERE document_id = ?", doc.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count query error = %v", err)
	}
	if count != 3 {
		t.Errorf("expected 3 chunks, got %d", count)
	}
}

func TestStoreChunksReplaces(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "replace.md", "/wiki", "wiki/replace.md")

	// First batch
	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "old chunk 1", TokenCount: 3},
		{ChunkIndex: 1, Content: "old chunk 2", TokenCount: 3},
	}); err != nil {
		t.Fatalf("StoreChunks() first error = %v", err)
	}

	// Second batch (should replace)
	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "new chunk", TokenCount: 2},
	}); err != nil {
		t.Fatalf("StoreChunks() second error = %v", err)
	}

	var count int
	err := db.DB().QueryRow("SELECT COUNT(*) FROM document_chunks WHERE document_id = ?", doc.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count query error = %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 chunk after replace, got %d", count)
	}

	// Verify it's the new chunk
	var content string
	err = db.DB().QueryRow("SELECT content FROM document_chunks WHERE document_id = ? AND chunk_index = 0", doc.ID).Scan(&content)
	if err != nil {
		t.Fatalf("content query error = %v", err)
	}
	if content != "new chunk" {
		t.Errorf("expected 'new chunk', got %q", content)
	}
}

func TestDeleteChunks(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "delchunk.md", "/wiki", "wiki/delchunk.md")

	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "to be deleted", TokenCount: 3},
	}); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	if err := db.DeleteChunks(doc.ID); err != nil {
		t.Fatalf("DeleteChunks() error = %v", err)
	}

	var count int
	err := db.DB().QueryRow("SELECT COUNT(*) FROM document_chunks WHERE document_id = ?", doc.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count query error = %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 chunks after delete, got %d", count)
	}
}

func TestSearchChunks(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "searchable.md", "/wiki", "wiki/searchable.md")

	chunks := []Chunk{
		{ChunkIndex: 0, Content: "The quick brown fox jumps over the lazy dog", TokenCount: 10},
		{ChunkIndex: 1, Content: "Machine learning models process natural language", TokenCount: 7},
		{ChunkIndex: 2, Content: "Database indexing improves query performance", TokenCount: 6},
	}
	if err := db.StoreChunks(doc.ID, chunks); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	results, err := db.SearchChunks("machine learning", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected search results, got none")
	}

	// Verify result has expected fields
	r := results[0]
	if r.Content == "" {
		t.Error("expected non-empty Content in search result")
	}
	if r.Filename != "searchable.md" {
		t.Errorf("expected Filename='searchable.md', got %q", r.Filename)
	}
	if r.DocumentID != doc.ID {
		t.Errorf("expected DocumentID=%q, got %q", doc.ID, r.DocumentID)
	}
}

func TestSearchChunksWithPathFilter(t *testing.T) {
	db := helperDB(t)

	// Wiki doc
	wikiDoc := createTestDocWithKind(t, db, "wiki-page.md", "/wiki", "wiki/wiki-page.md", "wiki")
	// Source doc
	srcDoc := createTestDocWithKind(t, db, "paper.pdf", "/sources", "sources/paper.pdf", "source")

	for _, doc := range []struct {
		id      string
		content string
	}{
		{wikiDoc.ID, "quantum computing breakthrough"},
		{srcDoc.ID, "quantum computing research paper"},
	} {
		if err := db.StoreChunks(doc.id, []Chunk{
			{ChunkIndex: 0, Content: doc.content, TokenCount: 5},
		}); err != nil {
			t.Fatalf("StoreChunks() error = %v", err)
		}
	}

	// Search wiki only
	wikiResults, err := db.SearchChunks("quantum", 10, "wiki")
	if err != nil {
		t.Fatalf("SearchChunks() wiki error = %v", err)
	}
	for _, r := range wikiResults {
		if r.Path != "/wiki" {
			t.Errorf("wiki filter: expected Path='/wiki', got %q", r.Path)
		}
	}

	// Search sources only
	srcResults, err := db.SearchChunks("quantum", 10, "sources")
	if err != nil {
		t.Fatalf("SearchChunks() sources error = %v", err)
	}
	for _, r := range srcResults {
		if r.Path != "/sources" {
			t.Errorf("sources filter: expected Path='/sources', got %q", r.Path)
		}
	}
}

func TestSearchChunksNoResults(t *testing.T) {
	db := helperDB(t)

	results, err := db.SearchChunks("nonexistent term xyz", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected no results, got %d", len(results))
	}
}

func TestFTSTriggers(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "fts-trigger.md", "/wiki", "wiki/fts-trigger.md")

	// Insert chunks — FTS should auto-populate
	if err := db.StoreChunks(doc.ID, []Chunk{
		{ChunkIndex: 0, Content: "unique test phrase alpha beta gamma", TokenCount: 6},
	}); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	// Verify FTS has the content
	results, err := db.SearchChunks("alpha beta gamma", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results) == 0 {
		t.Fatal("FTS trigger did not populate index on INSERT")
	}

	// Delete chunks — FTS should auto-clean
	if err := db.DeleteChunks(doc.ID); err != nil {
		t.Fatalf("DeleteChunks() error = %v", err)
	}

	results2, err := db.SearchChunks("alpha beta gamma", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() error = %v", err)
	}
	if len(results2) != 0 {
		t.Error("FTS trigger did not clean up on DELETE")
	}
}

func TestSearchChunkCJK(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "cjk.md", "/wiki", "wiki/cjk.md")

	chunks := []Chunk{
		{ChunkIndex: 0, Content: "这是一段中文测试文本，用于验证全文搜索功能", TokenCount: 10},
		{ChunkIndex: 1, Content: "機械学習モデルは自然言語を処理する", TokenCount: 8},
	}
	if err := db.StoreChunks(doc.ID, chunks); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}

	results, err := db.SearchChunks("中文", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks() CJK error = %v", err)
	}
	// Note: unicode61 tokenizer has limited CJK support. Full CJK bigram support
	// will be addressed in task 5.4. For now, just verify the query doesn't error.
	t.Logf("CJK search returned %d results (unicode61 tokenizer, full CJK support pending task 5.4)", len(results))
}

// --- helpers ---

func createTestDoc(t *testing.T, db *DB, filename, path, relPath string) *Document {
	t.Helper()
	return createTestDocWithKind(t, db, filename, path, relPath, "wiki")
}

func createTestDocWithKind(t *testing.T, db *DB, filename, path, relPath, kind string) *Document {
	t.Helper()
	doc := &Document{
		UserID:       "test-user",
		Filename:     filename,
		Title:        filename,
		Path:         path,
		RelativePath: relPath,
		SourceKind:   kind,
		FileType:     "md",
		Status:       "ready",
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}
	return doc
}
