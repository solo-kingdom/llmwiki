package ingest

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeJobSourceSessionArchive(t *testing.T) {
	dir := t.TempDir()
	rel := "raw/sources/web-ingest/sessions/x/archive-test.md"
	full := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("# archived"), 0o644); err != nil {
		t.Fatal(err)
	}
	n, err := NormalizeJobSource(dir, string(InputKindSessionArchive), rel, "session:x")
	if err != nil {
		t.Fatal(err)
	}
	if string(n.Content) != "# archived" {
		t.Fatalf("content = %q", n.Content)
	}
}
