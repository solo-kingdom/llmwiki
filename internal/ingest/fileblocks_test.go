package ingest

import (
	"context"
	"errors"
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

func TestNormalizeWikiFilePath(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"wiki/entities/Foo.md", "wiki/entities/Foo.md"},
		{"entity/RT-Merger.md", "wiki/entities/RT-Merger.md"},
		{"entities/RT-Merger.md", "wiki/entities/RT-Merger.md"},
		{"concept/Bar.md", "wiki/concepts/Bar.md"},
		{"source/Src.md", "wiki/sources/Src.md"},
		{"synthesis/Overview.md", "wiki/synthesis/Overview.md"},
		{"comparison/A-vs-B.md", "wiki/comparisons/A-vs-B.md"},
		{"query/Q.md", "wiki/queries/Q.md"},
	}
	for _, tt := range tests {
		got, err := NormalizeWikiFilePath(tt.in)
		if err != nil {
			t.Fatalf("NormalizeWikiFilePath(%q): %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("NormalizeWikiFilePath(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
	_, err := NormalizeWikiFilePath("notes/foo.md")
	if err == nil {
		t.Fatal("expected error for unrecognized prefix")
	}
}

func TestApplyWikiBlocksNormalizesEntityShorthand(t *testing.T) {
	ws := t.TempDir()
	blocks := map[string]string{
		"entity/RT-Merger.md": "# RT Merger\n\nBody.\n",
	}
	paths, err := ApplyWikiBlocks(context.Background(), ws, blocks, nil)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}
	if len(paths) != 1 || paths[0] != "wiki/entities/RT-Merger.md" {
		t.Fatalf("paths = %v", paths)
	}
	if _, err := os.Stat(filepath.Join(ws, "wiki", "entities", "RT-Merger.md")); err != nil {
		t.Fatalf("expected file on disk: %v", err)
	}
}

func TestApplyWikiBlocksZeroWriteFails(t *testing.T) {
	ws := t.TempDir()
	// Valid prefix but content identical to existing triggers skip in merge mode;
	// with nil opts, misplaced path after failed normalization is an error.
	_, err := ApplyWikiBlocks(context.Background(), ws, map[string]string{
		"random/top.md": "# X\n",
	}, nil)
	if err == nil {
		t.Fatal("expected error for unrecognized path")
	}

	// All blocks deleted only — still counts as zero writes when blocks were present.
	_, err = ApplyWikiBlocks(context.Background(), ws, map[string]string{
		"wiki/entities/Gone.md": "---DELETE---\n",
	}, nil)
	if !errors.Is(err, errNoWikiFilesWritten) {
		t.Fatalf("expected errNoWikiFilesWritten, got %v", err)
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
