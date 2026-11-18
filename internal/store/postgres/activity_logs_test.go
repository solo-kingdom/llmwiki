package postgres_test

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestActivityLogsCRUDAndTrim(t *testing.T) {
	db := pgtest.Open(t)

	for i := 0; i < 5; i++ {
		log := &store.ActivityLog{
			Category: "system",
			Action:   "test",
			Message:  "msg",
			Level:    "info",
			Source:   "test",
		}
		if err := db.CreateActivityLog(log); err != nil {
			t.Fatalf("CreateActivityLog #%d: %v", i, err)
		}
		if log.ID <= 0 {
			t.Fatalf("CreateActivityLog #%d did not set ID", i)
		}
		if log.CreatedAt == "" {
			t.Fatalf("CreateActivityLog #%d did not set CreatedAt", i)
		}
	}

	// Empty and invalid levels normalize to "info"; category/action are required.
	for _, lvl := range []string{"", "bogus"} {
		norm := &store.ActivityLog{Category: "system", Action: "norm", Level: lvl}
		if err := db.CreateActivityLog(norm); err != nil {
			t.Fatalf("CreateActivityLog level %q: %v", lvl, err)
		}
		if norm.Level != "info" {
			t.Fatalf("level %q normalized to %q, want info", lvl, norm.Level)
		}
	}
	if err := db.CreateActivityLog(&store.ActivityLog{Action: "x"}); err == nil {
		t.Fatal("expected error for missing category")
	}
	if err := db.CreateActivityLog(&store.ActivityLog{Category: "x"}); err == nil {
		t.Fatal("expected error for missing action")
	}
	if err := db.CreateActivityLog(nil); err == nil {
		t.Fatal("expected error for nil log")
	}
	if err := db.CreateActivityLog(&store.ActivityLog{Category: "system", Action: "warn", Level: "WARN"}); err != nil {
		t.Fatal(err)
	}

	all, err := db.ListActivityLogs(store.ActivityLogListFilter{Limit: 10})
	if err != nil {
		t.Fatalf("ListActivityLogs: %v", err)
	}
	if len(all) != 8 {
		t.Fatalf("len(logs) = %d, want 8", len(all))
	}
	if all[0].Level != "warn" {
		t.Fatalf("newest log level = %q, want warn", all[0].Level)
	}

	filtered, err := db.ListActivityLogs(store.ActivityLogListFilter{
		Limit: 10, Category: "system", Level: "info",
	})
	if err != nil {
		t.Fatalf("ListActivityLogs filtered: %v", err)
	}
	if len(filtered) != 7 {
		t.Fatalf("filtered len = %d, want 7", len(filtered))
	}

	// Limit/offset paging, newest first.
	page, err := db.ListActivityLogs(store.ActivityLogListFilter{Limit: 2, Offset: 6})
	if err != nil || len(page) != 2 {
		t.Fatalf("paged ListActivityLogs = %d, %v; want 2", len(page), err)
	}

	// A bad limit falls back to the default page size (50).
	limited, err := db.ListActivityLogs(store.ActivityLogListFilter{Limit: -1})
	if err != nil || len(limited) != 8 {
		t.Fatalf("default limit list = %d, %v; want 8", len(limited), err)
	}

	count, err := db.CountActivityLogs("system", "info")
	if err != nil || count != 7 {
		t.Fatalf("CountActivityLogs = %d, %v; want 7", count, err)
	}
	count, err = db.CountActivityLogs("", "")
	if err != nil || count != 8 {
		t.Fatalf("CountActivityLogs all = %d, %v; want 8", count, err)
	}

	got, err := db.GetActivityLog(all[0].ID)
	if err != nil || got == nil || got.ID != all[0].ID {
		t.Fatalf("GetActivityLog = %+v, %v", got, err)
	}
	if got, err := db.GetActivityLog(999999); err != nil || got != nil {
		t.Fatalf("GetActivityLog missing = %+v, %v; want nil, nil", got, err)
	}

	deleted, err := db.TrimActivityLogs(3)
	if err != nil || deleted != 5 {
		t.Fatalf("TrimActivityLogs(3) = %d, %v; want 5", deleted, err)
	}
	remaining, _ := db.CountActivityLogs("", "")
	if remaining != 3 {
		t.Fatalf("remaining = %d, want 3", remaining)
	}
	if deleted, err := db.TrimActivityLogs(3); err != nil || deleted != 0 {
		t.Fatalf("TrimActivityLogs(3) again = %d, %v; want 0", deleted, err)
	}
	if _, err := db.TrimActivityLogs(-1); err == nil {
		t.Fatal("expected error for negative maxCount")
	}

	n, err := db.DeleteAllActivityLogs()
	if err != nil || n != 3 {
		t.Fatalf("DeleteAllActivityLogs = %d, %v; want 3", n, err)
	}
	if n, err := db.DeleteAllActivityLogs(); err != nil || n != 0 {
		t.Fatalf("DeleteAllActivityLogs empty = %d, %v; want 0", n, err)
	}
}
