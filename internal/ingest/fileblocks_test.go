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
		"wiki/generated.md": "# Generated\n\nUniqueSearchTermXYZ123 content here.\n",
	}
	paths, err := ApplyWikiBlocks(context.Background(), ws, blocks, nil)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}
	if len(paths) != 1 || paths[0] != "wiki/generated.md" {
		t.Fatalf("paths = %v, want [wiki/generated.md]", paths)
	}

	data, err := os.ReadFile(filepath.Join(ws, "wiki", "generated.md"))
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(string(data), "UniqueSearchTermXYZ123") {
		t.Fatalf("file content missing expected text: %q", string(data))
	}
}
