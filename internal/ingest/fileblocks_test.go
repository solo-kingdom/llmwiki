package ingest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyWikiBlocksWritesFiles(t *testing.T) {
	ws := t.TempDir()
	blocks := map[string]string{
		"wiki/entities/generated.md": "# Generated\n\nUniqueSearchTermXYZ123 content here.\n",
	}
	paths, err := ApplyWikiBlocks(context.Background(), ws, blocks, nil)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}
	if len(paths) != 1 || paths[0] != "wiki/entities/generated.md" {
		t.Fatalf("paths = %v, want [wiki/entities/generated.md]", paths)
	}

	data, err := os.ReadFile(filepath.Join(ws, "wiki", "entities", "generated.md"))
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(string(data), "UniqueSearchTermXYZ123") {
		t.Fatalf("file content missing expected text: %q", string(data))
	}
}

func TestApplyWikiBlocksRejectsMisplacedTopLevelPage(t *testing.T) {
	ws := t.TempDir()
	_, err := ApplyWikiBlocks(context.Background(), ws, map[string]string{
		"wiki/dsp.md": "# DSP\n",
	}, nil)
	if err == nil {
		t.Fatal("expected error for top-level business page")
	}
	if !strings.Contains(err.Error(), "misplaced business page") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestApplyWikiBlocksAllowsReservedTopLevelPages(t *testing.T) {
	ws := t.TempDir()
	paths, err := ApplyWikiBlocks(context.Background(), ws, map[string]string{
		"wiki/overview.md": "---\ntitle: Overview\n---\n# Overview\n",
	}, nil)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}
	if len(paths) != 1 || paths[0] != "wiki/overview.md" {
		t.Fatalf("paths = %v", paths)
	}
}

func TestApplyWikiBlocksRejectsTemplateTarget(t *testing.T) {
	ws := t.TempDir()
	_, err := ApplyWikiBlocks(context.Background(), ws, map[string]string{
		"wiki/templates/entity.md": "# Template\n",
	}, nil)
	if err == nil {
		t.Fatal("expected error for template path")
	}
	if !strings.Contains(err.Error(), "system template path") {
		t.Fatalf("unexpected error: %v", err)
	}
}
