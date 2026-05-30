package ingest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestProcessorIndexesWrittenWikiFiles(t *testing.T) {
	ws := t.TempDir()
	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	longBody := "UniqueIngestIndexToken98765 appears in this paragraph. " +
		strings.Repeat("Additional indexing filler text for chunk token minimum. ", 20)
	blocks := map[string]string{
		"wiki/entities/searchable-ingest.md": "# Searchable\n\n" + longBody + "\n",
	}
	result, err := ApplyWikiBlocks(context.Background(), ws, blocks, nil)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}

	adapter := storesvc.NewStoreAdapter(db)
	indexer := engine.NewWorkspaceFileIndexer(adapter, ws)
	for _, rel := range result.Written {
		if err := indexer.IndexFile(rel); err != nil {
			t.Fatalf("IndexFile(%s): %v", rel, err)
		}
	}

	var chunkCount int
	if err := db.DB().QueryRow("SELECT COUNT(*) FROM document_chunks").Scan(&chunkCount); err != nil {
		t.Fatalf("count chunks: %v", err)
	}
	if chunkCount == 0 {
		t.Fatal("expected document_chunks rows after indexing")
	}

	results, err := db.SearchChunks("UniqueIngestIndexToken98765", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected search results after ingest indexing, got none")
	}
	if results[0].DocumentID == "" {
		t.Error("expected document_id in search result")
	}
	if results[0].Filename != "searchable-ingest.md" {
		t.Errorf("filename = %q, want searchable-ingest.md", results[0].Filename)
	}
}

func TestPipelineFileBlocksWritePaths(t *testing.T) {
	ws := t.TempDir()

	output := "---FILE: wiki/entities/from-pipeline.md\n# From Pipeline\n\nPipelineWriteToken555.\n---END FILE---"
	blocks := parseFileBlocksWithContent(output)
	paths, err := ApplyWikiBlocks(context.Background(), ws, blocks, nil)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}
	if len(paths.Written) != 1 {
		t.Fatalf("paths = %v", paths.Written)
	}
	if _, err := os.Stat(filepath.Join(ws, "wiki", "entities", "from-pipeline.md")); err != nil {
		t.Fatalf("expected file on disk: %v", err)
	}
}
