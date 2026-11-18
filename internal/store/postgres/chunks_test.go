package postgres_test

import (
	"context"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func countChunks(t *testing.T, db *postgres.DB, docID string) int {
	t.Helper()
	var n int
	if err := db.Pool().QueryRow(context.Background(),
		"SELECT COUNT(*) FROM document_chunks WHERE document_id = $1", docID).Scan(&n); err != nil {
		t.Fatalf("count chunks: %v", err)
	}
	return n
}

func TestStoreChunksReplacesAndDeletes(t *testing.T) {
	db := pgtest.Open(t)
	doc := seedPGDoc(t, db, "", "chunked.md", "/wiki", "wiki/chunked.md", "wiki")

	if err := db.StoreChunks(doc.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "first chunk", Page: 1, TokenCount: 2},
		{ChunkIndex: 1, Content: "second chunk", Page: 2, TokenCount: 2},
	}); err != nil {
		t.Fatalf("StoreChunks: %v", err)
	}
	if n := countChunks(t, db, doc.ID); n != 2 {
		t.Fatalf("chunk count = %d, want 2", n)
	}

	if err := db.StoreChunks(doc.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "replacement", TokenCount: 1},
	}); err != nil {
		t.Fatalf("StoreChunks replace: %v", err)
	}
	if n := countChunks(t, db, doc.ID); n != 1 {
		t.Fatalf("chunk count after replace = %d, want 1", n)
	}

	if err := db.DeleteChunks(doc.ID); err != nil {
		t.Fatalf("DeleteChunks: %v", err)
	}
	if n := countChunks(t, db, doc.ID); n != 0 {
		t.Fatalf("chunk count after delete = %d, want 0", n)
	}
}

func TestSearchChunksFTSAndMetadata(t *testing.T) {
	db := pgtest.Open(t)
	doc := seedPGDoc(t, db, "", "searchable.md", "/wiki", "wiki/searchable.md", "wiki")

	if err := db.StoreChunks(doc.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "The quick brown fox jumps over the lazy dog", TokenCount: 10},
		{ChunkIndex: 1, Content: "Machine learning models process natural language", TokenCount: 7},
		{ChunkIndex: 2, Content: "Database indexing improves query performance", TokenCount: 6},
	}); err != nil {
		t.Fatalf("StoreChunks: %v", err)
	}

	results, err := db.SearchChunks("machine learning", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks FTS: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected FTS results")
	}
	if results[0].DocumentID != doc.ID || results[0].Filename != "searchable.md" {
		t.Errorf("unexpected hit: %+v", results[0])
	}
	if results[0].Content == "" {
		t.Error("Content is empty")
	}

	// Metadata-only match: the term is in the filename, not the chunk body.
	metaDoc := seedPGDoc(t, db, "", "unique-filename-report.md", "/wiki", "wiki/unique-filename-report.md", "wiki")
	if err := db.StoreChunks(metaDoc.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "body without the search token", TokenCount: 5},
	}); err != nil {
		t.Fatalf("StoreChunks(meta): %v", err)
	}
	meta, err := db.SearchChunks("unique-filename-report", 10, "wiki")
	if err != nil {
		t.Fatalf("SearchChunks metadata: %v", err)
	}
	if len(meta) == 0 || meta[0].Filename != "unique-filename-report.md" {
		t.Fatalf("metadata search = %+v, want unique-filename-report.md", meta)
	}

	// CJK falls through to ILIKE inside the FTS stage.
	cjkDoc := seedPGDoc(t, db, "", "cjk.md", "/wiki", "wiki/cjk.md", "wiki")
	if err := db.StoreChunks(cjkDoc.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "这是一段中文测试文本，用于验证全文搜索功能", TokenCount: 10},
	}); err != nil {
		t.Fatalf("StoreChunks(cjk): %v", err)
	}
	cjk, err := db.SearchChunks("中文测试", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks CJK: %v", err)
	}
	if len(cjk) == 0 || cjk[0].DocumentID != cjkDoc.ID {
		t.Fatalf("CJK search = %+v, want document %s", cjk, cjkDoc.ID)
	}

	empty, err := db.SearchChunks("   ", 10, "")
	if err != nil || empty != nil {
		t.Errorf("SearchChunks(empty) = %v, %v; want nil, nil", empty, err)
	}

	noHits, err := db.SearchChunks("nonexistenttermxyz", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks(no hits): %v", err)
	}
	if len(noHits) != 0 {
		t.Errorf("expected no hits, got %d", len(noHits))
	}
}

func TestSearchChunksPathFilter(t *testing.T) {
	db := pgtest.Open(t)
	wikiDoc := seedPGDoc(t, db, "", "wiki-page.md", "/wiki/", "wiki/wiki-page.md", "wiki")
	srcDoc := seedPGDoc(t, db, "", "paper.pdf", "/sources", "sources/paper.pdf", "source")

	for _, d := range []struct {
		id      string
		content string
	}{
		{wikiDoc.ID, "quantum computing breakthrough"},
		{srcDoc.ID, "quantum computing research paper"},
	} {
		if err := db.StoreChunks(d.id, []store.Chunk{
			{ChunkIndex: 0, Content: d.content, TokenCount: 5},
		}); err != nil {
			t.Fatalf("StoreChunks: %v", err)
		}
	}

	wikiHits, err := db.SearchChunks("quantum", 10, "wiki")
	if err != nil {
		t.Fatalf("SearchChunks(wiki): %v", err)
	}
	if len(wikiHits) == 0 {
		t.Fatal("expected wiki hits")
	}
	for _, r := range wikiHits {
		if r.Path != "/wiki/" {
			t.Errorf("wiki filter leaked path %q", r.Path)
		}
	}

	srcHits, err := db.SearchChunks("quantum", 10, "sources")
	if err != nil {
		t.Fatalf("SearchChunks(sources): %v", err)
	}
	if len(srcHits) == 0 {
		t.Fatal("expected source hits")
	}
	for _, r := range srcHits {
		if r.Path != "/sources" {
			t.Errorf("sources filter leaked path %q", r.Path)
		}
	}
}

func TestSearchChunksExcludesSoftDeleted(t *testing.T) {
	db := pgtest.Open(t)
	doc := seedPGDoc(t, db, "", "gone.md", "/wiki", "wiki/gone.md", "wiki")
	if err := db.StoreChunks(doc.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "disappearing act", TokenCount: 2},
	}); err != nil {
		t.Fatalf("StoreChunks: %v", err)
	}
	if _, err := db.ArchiveDocuments([]string{doc.ID}); err != nil {
		t.Fatalf("ArchiveDocuments: %v", err)
	}

	hits, err := db.SearchChunks("disappearing", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("soft-deleted document leaked into search: %+v", hits)
	}
}
