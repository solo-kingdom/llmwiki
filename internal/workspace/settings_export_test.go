package workspace

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestExportAndImportSettings(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "index.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := db.SetConfig("temperature", "0.5"); err != nil {
		t.Fatal(err)
	}
	if err := db.SetConfig("ui_language", "zh"); err != nil {
		t.Fatal(err)
	}

	ws := t.TempDir()
	if err := os.MkdirAll(filepath.Join(ws, ".llmwiki"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ExportSettings(db, ws); err != nil {
		t.Fatal(err)
	}

	db2Path := filepath.Join(dir, "index2.db")
	db2, err := sqlite.Open(db2Path)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()

	if err := ImportSettings(db2, ws); err != nil {
		t.Fatal(err)
	}
	temp, _ := db2.GetConfig("temperature")
	if temp != "0.5" {
		t.Errorf("temperature = %q, want 0.5", temp)
	}
}
