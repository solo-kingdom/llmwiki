package engine_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// TestIndexFileSyncsReferences verifies that indexing a wiki page with links
// automatically populates the document_references table.
func TestIndexFileSyncsReferences(t *testing.T) {
	ws := t.TempDir()

	// Create two wiki pages: one linking to the other
	wikiDir := filepath.Join(ws, "wiki", "concepts")
	if err := os.MkdirAll(wikiDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	targetContent := "# Attention\nAttention mechanism details."
	if err := os.WriteFile(filepath.Join(wikiDir, "attention.md"), []byte(targetContent), 0o644); err != nil {
		t.Fatalf("WriteFile target: %v", err)
	}

	sourceContent := "# Transformers\nSee [Attention](attention.md) for details."
	if err := os.WriteFile(filepath.Join(wikiDir, "transformers.md"), []byte(sourceContent), 0o644); err != nil {
		t.Fatalf("WriteFile source: %v", err)
	}

	// Set up DB and indexer
	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open: %v", err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	indexer := engine.NewWorkspaceFileIndexer(adapter, ws)

	// Index the target first so it exists in the document index
	if err := indexer.IndexFile("wiki/concepts/attention.md"); err != nil {
		t.Fatalf("IndexFile target: %v", err)
	}

	// Index the source page (contains a link to target)
	if err := indexer.IndexFile("wiki/concepts/transformers.md"); err != nil {
		t.Fatalf("IndexFile source: %v", err)
	}

	// Verify forward references were created
	transformersDoc, err := db.GetDocumentByPath("transformers.md", "/wiki/concepts/")
	if err != nil {
		t.Fatalf("GetDocumentByPath source: %v", err)
	}
	if transformersDoc == nil {
		t.Fatal("transformers.md not found in DB")
	}

	forwardRefs, err := db.GetForwardReferences(transformersDoc.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences: %v", err)
	}

	if len(forwardRefs) == 0 {
		t.Fatal("expected at least one forward reference (links_to → attention.md), got none")
	}

	foundLink := false
	for _, ref := range forwardRefs {
		if ref.Filename == "attention.md" && ref.ReferenceType == "links_to" {
			foundLink = true
			break
		}
	}
	if !foundLink {
		t.Errorf("expected links_to reference to attention.md, got refs: %+v", forwardRefs)
	}
}

// TestIndexFileSkipsReferencesForNonWiki verifies that non-wiki files
// do not trigger reference graph updates.
func TestIndexFileSkipsReferencesForNonWiki(t *testing.T) {
	ws := t.TempDir()

	// Create a raw source file
	rawDir := filepath.Join(ws, "raw", "sources")
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(rawDir, "notes.txt"), []byte("some source notes"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open: %v", err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	indexer := engine.NewWorkspaceFileIndexer(adapter, ws)

	if err := indexer.IndexFile("raw/sources/notes.txt"); err != nil {
		t.Fatalf("IndexFile: %v", err)
	}

	// Document should exist but no references
	doc, err := db.GetDocumentByPath("notes.txt", "/raw/sources/")
	if err != nil {
		t.Fatalf("GetDocumentByPath: %v", err)
	}
	if doc == nil {
		t.Fatal("expected notes.txt to be indexed")
	}

	forwardRefs, err := db.GetForwardReferences(doc.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences: %v", err)
	}
	if len(forwardRefs) != 0 {
		t.Errorf("expected no references for non-wiki file, got %d", len(forwardRefs))
	}
}

// TestIndexFileUpdateSyncsReferences verifies that updating a wiki page
// (re-indexing) correctly updates the reference graph.
func TestIndexFileUpdateSyncsReferences(t *testing.T) {
	ws := t.TempDir()

	wikiDir := filepath.Join(ws, "wiki")
	if err := os.MkdirAll(wikiDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	// Create target page
	if err := os.WriteFile(filepath.Join(wikiDir, "target.md"), []byte("# Target"), 0o644); err != nil {
		t.Fatalf("WriteFile target: %v", err)
	}

	// Create source page without links
	if err := os.WriteFile(filepath.Join(wikiDir, "source.md"), []byte("# Source\nNo links yet."), 0o644); err != nil {
		t.Fatalf("WriteFile source: %v", err)
	}

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("sqlite.Open: %v", err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	indexer := engine.NewWorkspaceFileIndexer(adapter, ws)

	// Initial index
	if err := indexer.IndexFile("wiki/target.md"); err != nil {
		t.Fatalf("IndexFile target: %v", err)
	}
	if err := indexer.IndexFile("wiki/source.md"); err != nil {
		t.Fatalf("IndexFile source: %v", err)
	}

	// Verify no references initially
	sourceDoc, _ := db.GetDocumentByPath("source.md", "/wiki/")
	refs, _ := db.GetForwardReferences(sourceDoc.ID)
	if len(refs) != 0 {
		t.Fatalf("expected 0 references initially, got %d", len(refs))
	}

	// Update source page to add a link
	updatedContent := "# Source\nSee [Target](target.md) for details."
	if err := os.WriteFile(filepath.Join(wikiDir, "source.md"), []byte(updatedContent), 0o644); err != nil {
		t.Fatalf("WriteFile updated source: %v", err)
	}

	// Re-index the source
	if err := indexer.IndexFile("wiki/source.md"); err != nil {
		t.Fatalf("IndexFile updated source: %v", err)
	}

	// Verify reference was created
	refs, err = db.GetForwardReferences(sourceDoc.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences: %v", err)
	}
	if len(refs) == 0 {
		t.Fatal("expected reference after update, got none")
	}
	foundLink := false
	for _, ref := range refs {
		if ref.Filename == "target.md" && ref.ReferenceType == "links_to" {
			foundLink = true
		}
	}
	if !foundLink {
		t.Errorf("expected links_to → target.md after update, got refs: %+v", refs)
	}
}
