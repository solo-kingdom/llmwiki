package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type stubIndexer struct {
	indexed []string
}

func (s *stubIndexer) IndexFile(relPath string) error {
	s.indexed = append(s.indexed, relPath)
	return nil
}

func writeWikiPageForMaintenance(t *testing.T, ws, rel, body string) {
	t.Helper()
	full := filepath.Join(ws, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPostApplyMaintenanceRebuildsIndex(t *testing.T) {
	ws := t.TempDir()
	writeWikiPageForMaintenance(t, ws, "wiki/entities/foo.md", `---
title: Foo
type: entity
date: 2026-01-01
description: test entity
---
# Foo
`)
	writeWikiPageForMaintenance(t, ws, "wiki/index.md", "# old index\n")
	writeWikiPageForMaintenance(t, ws, "wiki/overview.md", "# overview\n")
	writeWikiPageForMaintenance(t, ws, "wiki/log.md", "# log\n")

	idx := &stubIndexer{}
	result := PostApplyMaintenance(ws, PostApplyMaintenanceOpts{
		WrittenPaths: []string{"wiki/entities/foo.md"},
		Indexer:      idx,
	})
	if !result.IndexRebuilt {
		t.Fatal("expected index rebuild")
	}
	data, err := os.ReadFile(filepath.Join(ws, "wiki/index.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "Foo") {
		t.Fatalf("index should list entity page: %s", data)
	}
	if len(idx.indexed) == 0 || idx.indexed[0] != indexRelPath {
		t.Fatalf("expected index re-index, got %v", idx.indexed)
	}
}

func TestPostApplyMaintenanceSkipsWhenNoChanges(t *testing.T) {
	ws := t.TempDir()
	writeWikiPageForMaintenance(t, ws, "wiki/index.md", "# static\n")
	result := PostApplyMaintenance(ws, PostApplyMaintenanceOpts{})
	if result.IndexRebuilt {
		t.Fatal("expected no rebuild")
	}
}

func TestPostApplyMaintenanceOrganizeLog(t *testing.T) {
	ws := t.TempDir()
	writeWikiPageForMaintenance(t, ws, "wiki/log.md", "# Log\n\n## [2026-01-01] init | started\n")
	writeWikiPageForMaintenance(t, ws, "wiki/overview.md", "# o\n")
	writeWikiPageForMaintenance(t, ws, "wiki/index.md", "# i\n")

	idx := &stubIndexer{}
	result := PostApplyMaintenance(ws, PostApplyMaintenanceOpts{
		WrittenPaths: []string{"wiki/concepts/new.md"},
		SessionMode:  "organize",
		MoveCount:    2,
		PlanSummary:  "deduplicate concept pages",
		Indexer:      idx,
	})
	if !result.LogAppended {
		t.Fatal("expected log append")
	}
	data, err := os.ReadFile(filepath.Join(ws, "wiki/log.md"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(data)
	if !strings.Contains(s, "organize") || !strings.Contains(s, "移动 2 页") {
		t.Fatalf("unexpected log: %s", s)
	}
}

func TestPostApplyMaintenanceUpdateOnlyOrganizeSkipsLog(t *testing.T) {
	ws := t.TempDir()
	writeWikiPageForMaintenance(t, ws, "wiki/log.md", "# Log\n")
	writeWikiPageForMaintenance(t, ws, "wiki/overview.md", "# o\n")
	writeWikiPageForMaintenance(t, ws, "wiki/index.md", "# i\n")

	result := PostApplyMaintenance(ws, PostApplyMaintenanceOpts{
		WrittenPaths: []string{"wiki/concepts/x.md"},
		SessionMode:  "organize",
	})
	if result.LogAppended {
		t.Fatal("update-only organize should not append structure log")
	}
}
