package engine_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestReindexRebuildsWikiIndex(t *testing.T) {
	ws := t.TempDir()

	writeTestFile(t, ws, "wiki/entities/foo.md", `---
title: Foo Entity
description: An entity page
date: "2024-05-01"
---
# Foo`)
	writeTestFile(t, ws, "wiki/concepts/bar.md", `---
title: Bar Concept
description: A concept page
date: "2024-05-02"
---
# Bar`)

	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
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

	indexData, err := os.ReadFile(filepath.Join(ws, "wiki", "index.md"))
	if err != nil {
		t.Fatalf("ReadFile index.md: %v", err)
	}
	index := string(indexData)
	if !strings.Contains(index, "[[entities/foo|Foo Entity]]") {
		t.Errorf("index missing entity entry:\n%s", index)
	}
	if !strings.Contains(index, "[[concepts/bar|Bar Concept]]") {
		t.Errorf("index missing concept entry:\n%s", index)
	}

	doc, err := db.GetDocumentByPath("index.md", "/wiki/")
	if err != nil {
		t.Fatalf("GetDocumentByPath: %v", err)
	}
	if doc == nil {
		t.Fatal("expected wiki/index.md to be indexed in SQLite")
	}
	if doc.Title != "内容目录" {
		t.Errorf("index title = %q, want 内容目录", doc.Title)
	}
}

func writeTestFile(t *testing.T, ws, rel, content string) {
	t.Helper()
	path := filepath.Join(ws, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
}
