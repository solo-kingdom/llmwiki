package workspace

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestExportAndImportSettings(t *testing.T) {
	db := pgtest.Open(t)

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

	// Clear the exported keys to simulate importing into an empty database.
	// A second pgtest store cannot be opened while this one is live because the
	// pg_trgm/vector extensions are database-scoped, not schema-scoped.
	for _, key := range []string{"temperature", "ui_language"} {
		if err := db.SetConfig(key, ""); err != nil {
			t.Fatal(err)
		}
	}

	if err := ImportSettings(db, ws); err != nil {
		t.Fatal(err)
	}
	temp, _ := db.GetConfig("temperature")
	if temp != "0.5" {
		t.Errorf("temperature = %q, want 0.5", temp)
	}
	lang, _ := db.GetConfig("ui_language")
	if lang != "zh" {
		t.Errorf("ui_language = %q, want zh", lang)
	}
}
