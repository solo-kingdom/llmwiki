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
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

func wikiMaintenanceStubs(t *testing.T, ws string) {
	t.Helper()
	for _, rel := range []string{"wiki/overview.md", "wiki/log.md", "wiki/index.md"} {
		full := filepath.Join(ws, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("# stub\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFinalizeWikiApplyRebuildsIndex(t *testing.T) {
	ws := t.TempDir()
	wikiMaintenanceStubs(t, ws)
	entityPath := filepath.Join(ws, "wiki", "entities", "new-page.md")
	if err := os.MkdirAll(filepath.Dir(entityPath), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\ntitle: New Page\ntype: entity\ndate: 2026-01-01\ndescription: test\n---\n# New Page\n"
	if err := os.WriteFile(entityPath, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	p := &JobProcessor{workspace: ws}
	p.finalizeWikiApply("job-1", "", "", ApplyWikiResult{Written: []string{"wiki/entities/new-page.md"}})

	data, err := os.ReadFile(filepath.Join(ws, "wiki/index.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "New Page") {
		t.Fatalf("index not rebuilt: %s", data)
	}
}

func TestFinalizeWikiApplyCommitsMaintenanceWithGit(t *testing.T) {
	if !vcs.IsGitAvailable().Available {
		t.Skip("git not available")
	}

	ws := t.TempDir()
	wikiMaintenanceStubs(t, ws)
	repo, err := vcs.InitRepo(ws)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	entityPath := filepath.Join(ws, "wiki", "entities", "new-page.md")
	if err := os.MkdirAll(filepath.Dir(entityPath), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\ntitle: New Page\ntype: entity\ndate: 2026-01-01\ndescription: test\n---\n# New Page\n"
	if err := os.WriteFile(entityPath, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	p := &JobProcessor{workspace: ws}
	p.SetGitRepo(repo)
	p.finalizeWikiApply("job-1", "", "", ApplyWikiResult{Written: []string{"wiki/entities/new-page.md"}})

	dirty, err := repo.HasUncommittedWikiMaintenance()
	if err != nil {
		t.Fatalf("HasUncommittedWikiMaintenance: %v", err)
	}
	if dirty {
		t.Fatal("expected wiki maintenance files to be committed after finalizeWikiApply")
	}
}

func TestApplyWikiBlocksThenPostApplyMaintenance(t *testing.T) {
	ws := t.TempDir()
	wikiMaintenanceStubs(t, ws)

	result, err := ApplyWikiBlocks(context.Background(), ws, map[string]string{
		"wiki/entities/apply-index.md": "---\ntitle: Apply Index\ntype: entity\ndate: 2026-01-01\ndescription: x\n---\n# Apply Index\n",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	maint := engine.PostApplyMaintenance(ws, engine.PostApplyMaintenanceOpts{
		WrittenPaths: result.Written,
		DeletedPaths: result.Deleted,
	})
	if !maint.IndexRebuilt {
		t.Fatal("expected index rebuild")
	}
}

func TestFinalizeWikiApplyRemovesDeletedFromIndex(t *testing.T) {
	ws := t.TempDir()
	wikiMaintenanceStubs(t, ws)

	gonePath := filepath.Join(ws, "wiki", "entities", "gone.md")
	if err := os.MkdirAll(filepath.Dir(gonePath), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\ntitle: Gone\ntype: entity\ndate: 2026-01-01\ndescription: x\n---\n# Gone\n"
	if err := os.WriteFile(gonePath, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	adapter := storesvc.NewStoreAdapter(db)
	indexer := engine.NewWorkspaceFileIndexer(adapter, ws)
	if err := indexer.IndexFile("wiki/entities/gone.md"); err != nil {
		t.Fatal(err)
	}

	result, err := ApplyWikiBlocks(context.Background(), ws, map[string]string{
		"wiki/entities/gone.md": "---DELETE---\n",
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	p := &JobProcessor{workspace: ws, indexer: indexer}
	p.finalizeWikiApply("job-delete", "", "", result)

	doc, err := db.GetDocumentByPath("gone.md", "/wiki/entities/")
	if err != nil {
		t.Fatal(err)
	}
	if doc != nil {
		t.Fatal("expected deleted wiki page to be removed from SQLite index")
	}
}
