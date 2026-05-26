package sqlite

import (
	"testing"
)

func TestActivityLogsCRUDAndTrim(t *testing.T) {
	db := helperDB(t)

	for i := 0; i < 5; i++ {
		if err := db.CreateActivityLog(&ActivityLog{
			Category: "system",
			Action:   "test",
			Message:  "msg",
			Level:    "info",
			Source:   "test",
		}); err != nil {
			t.Fatalf("CreateActivityLog #%d: %v", i, err)
		}
	}

	all, err := db.ListActivityLogs(ActivityLogListFilter{Limit: 10})
	if err != nil {
		t.Fatalf("ListActivityLogs: %v", err)
	}
	if len(all) != 5 {
		t.Fatalf("len(logs) = %d, want 5", len(all))
	}

	filtered, err := db.ListActivityLogs(ActivityLogListFilter{
		Limit: 10, Category: "system", Level: "info",
	})
	if err != nil {
		t.Fatalf("ListActivityLogs filtered: %v", err)
	}
	if len(filtered) != 5 {
		t.Fatalf("filtered len = %d, want 5", len(filtered))
	}

	deleted, err := db.TrimActivityLogs(3)
	if err != nil || deleted != 2 {
		t.Fatalf("TrimActivityLogs(3) = %d, %v; want 2", deleted, err)
	}
	remaining, _ := db.CountActivityLogs("", "")
	if remaining != 3 {
		t.Fatalf("remaining = %d, want 3", remaining)
	}

	n, err := db.DeleteAllActivityLogs()
	if err != nil || n != 3 {
		t.Fatalf("DeleteAllActivityLogs = %d, %v", n, err)
	}
}

func TestActivityLogsSurviveReindexSimulation(t *testing.T) {
	db := helperDB(t)

	if err := db.CreateActivityLog(&ActivityLog{
		Category: "ingest",
		Action:   "queued",
		Message:  "keep me",
		Level:    "info",
	}); err != nil {
		t.Fatal(err)
	}

	// Simulate reindex: delete derived tables only (not activity_logs)
	if _, err := db.DB().Exec(`DELETE FROM document_chunks`); err != nil {
		t.Fatal(err)
	}

	count, err := db.CountActivityLogs("", "")
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("activity_logs count = %d after simulated reindex, want 1", count)
	}
}
