package mcp

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestExecuteLocalStructureHeaderAndTypedDirs(t *testing.T) {
	ws := t.TempDir()
	dbPath := filepath.Join(ws, ".llmwiki", "index.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := os.MkdirAll(filepath.Join(ws, "wiki", "templates"), 0o755); err != nil {
		t.Fatal(err)
	}

	for _, spec := range []struct {
		rel, filename, path, title string
	}{
		{"wiki/entities/sample.md", "sample.md", "/wiki/entities/", "Sample"},
		{"wiki/overview.md", "overview.md", "/wiki/", "Overview"},
		{"wiki/index.md", "index.md", "/wiki/", "Index"},
		{"wiki/log.md", "log.md", "/wiki/", "Log"},
	} {
		if err := db.CreateDocument(&sqlite.Document{
			Filename:     spec.filename,
			Title:        spec.title,
			Path:         spec.path,
			RelativePath: spec.rel,
			SourceKind:   "wiki",
			FileType:     "md",
			Content:      "# " + spec.title + "\n",
			Status:       "ready",
		}); err != nil {
			t.Fatal(err)
		}
	}

	out, err := executeLocalStructure(ws, db, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"# Wiki 目录结构",
		"工作区：`" + ws + "`",
		"SQLite index",
		"├── entities/",
		"├── concepts/",
		"├── synthesis/",
		"├── templates/",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("structure output missing %q:\n%s", want, out)
		}
	}
}
