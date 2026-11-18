package activity

import (
	"testing"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func testDB(t *testing.T) store.Store {
	t.Helper()
	return pgtest.Open(t)
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

	logs, err := db.ListActivityLogs(store.ActivityLogListFilter{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) < 2 {
		t.Fatalf("expected >=2 logs, got %d", len(logs))
	}
}
