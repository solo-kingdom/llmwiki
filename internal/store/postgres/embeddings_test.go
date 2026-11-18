package postgres_test

import (
	"context"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func chunkID(t *testing.T, db *postgres.DB, docID string, index int) string {
	t.Helper()
	var id string
	if err := db.Pool().QueryRow(context.Background(),
		"SELECT id FROM document_chunks WHERE document_id = $1 AND chunk_index = $2",
		docID, index).Scan(&id); err != nil {
		t.Fatalf("chunk id for %s[%d]: %v", docID, index, err)
	}
	return id
}

func TestStoreChunkEmbeddingsAndSearchVector(t *testing.T) {
	db := pgtest.Open(t)
	wiki := seedPGDoc(t, db, "", "alpha.md", "/wiki", "wiki/alpha.md", "wiki")
	src := seedPGDoc(t, db, "", "beta.pdf", "/sources", "sources/beta.pdf", "source")

	if err := db.StoreChunks(wiki.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "alpha content", TokenCount: 2},
		{ChunkIndex: 1, Content: "alpha appendix", TokenCount: 2},
	}); err != nil {
		t.Fatalf("StoreChunks(wiki): %v", err)
	}
	if err := db.StoreChunks(src.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "beta content", TokenCount: 2},
	}); err != nil {
		t.Fatalf("StoreChunks(src): %v", err)
	}

	missing, err := db.ChunksMissingEmbedding("test-model", 10)
	if err != nil {
		t.Fatalf("ChunksMissingEmbedding: %v", err)
	}
	if len(missing) != 3 {
		t.Fatalf("missing = %d, want 3", len(missing))
	}

	wikiChunk := chunkID(t, db, wiki.ID, 0)
	srcChunk := chunkID(t, db, src.ID, 0)
	if err := db.StoreChunkEmbeddings([]store.ChunkEmbedding{
		{ChunkID: wikiChunk, Model: "test-model", Dim: 3, Embedding: []float32{1, 0, 0}},
		{ChunkID: srcChunk, Model: "test-model", Dim: 3, Embedding: []float32{0, 1, 0}},
	}); err != nil {
		t.Fatalf("StoreChunkEmbeddings: %v", err)
	}

	missing, err = db.ChunksMissingEmbedding("test-model", 10)
	if err != nil {
		t.Fatalf("ChunksMissingEmbedding: %v", err)
	}
	if len(missing) != 1 || missing[0].ChunkIndex != 1 {
		t.Fatalf("missing after embed = %+v, want wiki chunk 1", missing)
	}
	otherModel, err := db.ChunksMissingEmbedding("other-model", 10)
	if err != nil {
		t.Fatalf("ChunksMissingEmbedding(other): %v", err)
	}
	if len(otherModel) != 3 {
		t.Fatalf("missing for other model = %d, want 3", len(otherModel))
	}

	hits, err := db.SearchVector([]float32{1, 0.1, 0}, "test-model", 10, "")
	if err != nil {
		t.Fatalf("SearchVector: %v", err)
	}
	if len(hits) != 2 {
		t.Fatalf("hits = %+v, want 2", hits)
	}
	if hits[0].DocumentID != wiki.ID {
		t.Errorf("nearest hit = %s, want wiki %s", hits[0].DocumentID, wiki.ID)
	}
	if hits[0].Content != "alpha content" || hits[0].Filename != "alpha.md" {
		t.Errorf("unexpected hit shape: %+v", hits[0])
	}

	other, err := db.SearchVector([]float32{1, 0.1, 0}, "other-model", 10, "")
	if err != nil {
		t.Fatalf("SearchVector(other): %v", err)
	}
	if len(other) != 0 {
		t.Errorf("other model hits = %+v, want none", other)
	}

	srcOnly, err := db.SearchVector([]float32{1, 0, 0}, "test-model", 10, "sources")
	if err != nil {
		t.Fatalf("SearchVector(sources): %v", err)
	}
	if len(srcOnly) != 1 || srcOnly[0].DocumentID != src.ID {
		t.Fatalf("sources filter = %+v, want src only", srcOnly)
	}

	typed, err := db.SearchVector([]float32{1, 0, 0}, "test-model", 10, "", "page")
	if err != nil {
		t.Fatalf("SearchVector(page type): %v", err)
	}
	if len(typed) != 2 {
		t.Fatalf("page type filter = %+v, want both untyped documents", typed)
	}
	none, err := db.SearchVector([]float32{1, 0, 0}, "test-model", 10, "", "entity")
	if err != nil {
		t.Fatalf("SearchVector(missing page type): %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("entity filter = %+v, want none", none)
	}

	// Upsert replaces the vector for the same (chunk, model).
	if err := db.StoreChunkEmbeddings([]store.ChunkEmbedding{
		{ChunkID: srcChunk, Model: "test-model", Dim: 3, Embedding: []float32{0, 0, 1}},
	}); err != nil {
		t.Fatalf("StoreChunkEmbeddings upsert: %v", err)
	}
	var count int
	if err := db.Pool().QueryRow(context.Background(),
		"SELECT COUNT(*) FROM chunk_embeddings WHERE chunk_id = $1 AND model = $2",
		srcChunk, "test-model").Scan(&count); err != nil {
		t.Fatalf("count embeddings: %v", err)
	}
	if count != 1 {
		t.Fatalf("embedding rows = %d, want 1 after upsert", count)
	}
	updated, err := db.SearchVector([]float32{0, 0, 1}, "test-model", 1, "")
	if err != nil {
		t.Fatalf("SearchVector after upsert: %v", err)
	}
	if len(updated) != 1 || updated[0].DocumentID != src.ID {
		t.Fatalf("after upsert nearest = %+v, want src", updated)
	}

	if err := db.StoreChunkEmbeddings(nil); err != nil {
		t.Errorf("StoreChunkEmbeddings(nil) = %v", err)
	}
}
