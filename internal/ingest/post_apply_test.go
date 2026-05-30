package ingest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

func TestFinalizeWikiApplyRebuildsIndex(t *testing.T) {
	ws := t.TempDir()
	for _, rel := range []string{"wiki/overview.md", "wiki/log.md", "wiki/index.md"} {
		full := filepath.Join(ws, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("# stub\n"), 0o644); err != nil {
			t.Fatal(err)
		}
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
	p.finalizeWikiApply("job-1", "", "", ApplyWikiResult{Written: []string{"wiki/entities/new-page.md"}})

	data, err := os.ReadFile(filepath.Join(ws, "wiki/index.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "New Page") {
		t.Fatalf("index not rebuilt: %s", data)
	}
}

func TestApplyWikiBlocksThenPostApplyMaintenance(t *testing.T) {
	ws := t.TempDir()
	for _, rel := range []string{"wiki/overview.md", "wiki/log.md", "wiki/index.md"} {
		full := filepath.Join(ws, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("# stub\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

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
