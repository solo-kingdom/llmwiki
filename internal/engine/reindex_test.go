package engine_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestReindexRecoversWebIngestedSources(t *testing.T) {
	ws := t.TempDir()

	sourceDir := filepath.Join(ws, "raw", "sources", "web-ingest")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "notes.txt"), []byte("web-ingested source"), 0o644); err != nil {
		t.Fatalf("WriteFile source: %v", err)
	}

	if err := os.MkdirAll(filepath.Join(ws, "wiki"), 0o755); err != nil {
		t.Fatalf("MkdirAll wiki: %v", err)
	}
	if err := os.WriteFile(filepath.Join(ws, "wiki", "overview.md"), []byte("# Overview"), 0o644); err != nil {
		t.Fatalf("WriteFile wiki: %v", err)
	}

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open: %v", err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	reindexer := engine.NewReindexer(adapter, ws)
	if _, err := reindexer.Rebuild("default"); err != nil {
		t.Fatalf("Rebuild: %v", err)
	}

	doc, err := db.GetDocumentByPath("notes.txt", "/raw/sources/web-ingest/")
	if err != nil {
		t.Fatalf("GetDocumentByPath: %v", err)
	}
	if doc == nil {
		t.Fatal("expected web-ingested source to be indexed after reindex")
	}
	if doc.SourceKind != "source" {
		t.Fatalf("source_kind = %q, want source", doc.SourceKind)
	}
}

func TestReindexRecoversMultipleWebIngestFormats(t *testing.T) {
	ws := t.TempDir()
	sourceDir := filepath.Join(ws, "raw", "sources", "web-ingest")

	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	// Write multiple web-ingested source files
	files := map[string]string{
		"conversation-20260101-120000.md": "# Conversation\nChatGPT export",
		"text-20260102-140000.md":         "# Notes\nManual text input",
		"report.pdf":                      "binary content placeholder",
		"data.csv":                        "name,value\nfoo,1\nbar,2",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(sourceDir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("WriteFile %s: %v", name, err)
		}
	}

	// Also write a wiki page
	if err := os.MkdirAll(filepath.Join(ws, "wiki"), 0o755); err != nil {
		t.Fatalf("MkdirAll wiki: %v", err)
	}
	if err := os.WriteFile(filepath.Join(ws, "wiki", "index.md"), []byte("# Home"), 0o644); err != nil {
		t.Fatalf("WriteFile wiki: %v", err)
	}

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open: %v", err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	reindexer := engine.NewReindexer(adapter, ws)
	count, err := reindexer.Rebuild("default")
	if err != nil {
		t.Fatalf("Rebuild: %v", err)
	}

	if count < len(files)+1 { // +1 for wiki page
		t.Fatalf("reindex count = %d, expected at least %d", count, len(files)+1)
	}

	// Verify all web-ingested sources are indexed
	for name := range files {
		doc, err := db.GetDocumentByPath(name, "/raw/sources/web-ingest/")
		if err != nil {
			t.Errorf("GetDocumentByPath(%s): %v", name, err)
		}
		if doc == nil {
			t.Errorf("web-ingested source %q not found after reindex", name)
		} else if doc.SourceKind != "source" {
			t.Errorf("source %q: source_kind = %q, want source", name, doc.SourceKind)
		}
	}
}

func TestReindexPreservesWebIngestAfterDoubleReindex(t *testing.T) {
	ws := t.TempDir()
	sourceDir := filepath.Join(ws, "raw", "sources", "web-ingest")

	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "persist.md"), []byte("persistent content"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	if err := os.MkdirAll(filepath.Join(ws, "wiki"), 0o755); err != nil {
		t.Fatalf("MkdirAll wiki: %v", err)
	}
	if err := os.WriteFile(filepath.Join(ws, "wiki", "page.md"), []byte("# Page"), 0o644); err != nil {
		t.Fatalf("WriteFile wiki: %v", err)
	}

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open: %v", err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	reindexer := engine.NewReindexer(adapter, ws)

	// First reindex
	if _, err := reindexer.Rebuild("default"); err != nil {
		t.Fatalf("First Rebuild: %v", err)
	}

	// Second reindex (should be idempotent)
	if _, err := reindexer.Rebuild("default"); err != nil {
		t.Fatalf("Second Rebuild: %v", err)
	}

	// Source should still be there
	doc, err := db.GetDocumentByPath("persist.md", "/raw/sources/web-ingest/")
	if err != nil {
		t.Fatalf("GetDocumentByPath: %v", err)
	}
	if doc == nil {
		t.Fatal("expected web-ingested source to survive double reindex")
	}
}
