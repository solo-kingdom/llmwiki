package engine_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestLintGhostIndexEntries(t *testing.T) {
	ws := t.TempDir()
	wikiDir := filepath.Join(ws, "wiki", "concepts")
	if err := os.MkdirAll(wikiDir, 0o755); err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	if err := adapter.CreateDocument(&engine.DocData{
		Filename:   "gone.md",
		Title:      "Gone",
		Path:       "/wiki/concepts/",
		Content:    "# Gone",
		SourceKind: "wiki",
		FileType:   "md",
		Status:     "ready",
	}); err != nil {
		t.Fatal(err)
	}

	issues, err := engine.LintGhostIndexEntries(ws, adapter)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected 1 ghost issue, got %d", len(issues))
	}
	if issues[0].Code != engine.LintCodeGhostIndexEntry {
		t.Fatalf("code = %q, want %q", issues[0].Code, engine.LintCodeGhostIndexEntry)
	}
}
