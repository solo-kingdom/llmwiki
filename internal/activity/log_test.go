package activity

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func testDB(t *testing.T) *sqlite.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := sqlite.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestSanitizeDetails(t *testing.T) {
	out := SanitizeDetails(map[string]interface{}{
		"api_key": "secret",
		"path":    "wiki/a.md",
	})
	if _, ok := out["api_key"]; ok {
		t.Fatal("api_key should be stripped")
	}
	if out["path"] != "wiki/a.md" {
		t.Fatalf("path = %v", out["path"])
	}
}

func TestRecordSyncAndAsync(t *testing.T) {
	db := testDB(t)
	Start()
	t.Cleanup(Stop)

	RecordSync(db, Entry{
		Category: "system",
		Action:   "test_sync",
		Message:  "sync",
		Source:   "test",
	})
	Record(db, Entry{
		Category: "system",
		Action:   "test_async",
		Message:  "async",
		Source:   "test",
	})
	time.Sleep(50 * time.Millisecond)

	logs, err := db.ListActivityLogs(sqlite.ActivityLogListFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) < 2 {
		t.Fatalf("expected >=2 logs, got %d", len(logs))
	}
}

func TestWatcherDebounceMerge(t *testing.T) {
	db := testDB(t)
	ResetDebounce()
	RecordWatcherModify(db, "wiki/a.md")
	RecordWatcherModify(db, "wiki/a.md")
	RecordWatcherModify(db, "wiki/a.md")
	time.Sleep(900 * time.Millisecond)

	logs, err := db.ListActivityLogs(sqlite.ActivityLogListFilter{
		Limit: 10, Category: "watcher",
	})
	if err != nil {
		t.Fatal(err)
	}
	modified := 0
	for _, l := range logs {
		if l.Action == "file_modified" {
			modified++
		}
	}
	if modified != 1 {
		t.Fatalf("file_modified count = %d, want 1 (debounced)", modified)
	}
}
