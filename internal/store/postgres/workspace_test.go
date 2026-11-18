package postgres_test

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestWorkspaceGetAndUpsert(t *testing.T) {
	db := pgtest.Open(t)

	ws, err := db.GetWorkspace()
	if err != nil {
		t.Fatalf("GetWorkspace empty: %v", err)
	}
	if ws != nil {
		t.Fatalf("GetWorkspace empty = %+v, want nil", ws)
	}

	first := &store.Workspace{
		ID:          "ws_1",
		Name:        "My Wiki",
		Description: "initial",
		UserID:      "user_1",
	}
	if err := db.UpsertWorkspace(first); err != nil {
		t.Fatalf("UpsertWorkspace insert: %v", err)
	}
	if first.CreatedAt == "" {
		t.Fatal("expected CreatedAt backfilled")
	}

	got, err := db.GetWorkspace()
	if err != nil || got == nil {
		t.Fatalf("GetWorkspace = %+v, %v", got, err)
	}
	if got.ID != "ws_1" || got.Name != "My Wiki" || got.Description != "initial" || got.UserID != "user_1" {
		t.Fatalf("unexpected workspace: %+v", got)
	}

	// Same user_id updates in place and keeps the original id/created_at.
	second := &store.Workspace{
		ID:          "ws_2",
		Name:        "Renamed",
		Description: "updated",
		UserID:      "user_1",
	}
	if err := db.UpsertWorkspace(second); err != nil {
		t.Fatalf("UpsertWorkspace update: %v", err)
	}
	if second.ID != "ws_1" {
		t.Fatalf("upsert replaced id with %q, want ws_1", second.ID)
	}
	if second.CreatedAt != first.CreatedAt {
		t.Fatalf("created_at changed: %q -> %q", first.CreatedAt, second.CreatedAt)
	}

	got, err = db.GetWorkspace()
	if err != nil || got == nil {
		t.Fatalf("GetWorkspace after update: %+v, %v", got, err)
	}
	if got.ID != "ws_1" || got.Name != "Renamed" || got.Description != "updated" {
		t.Fatalf("unexpected workspace after update: %+v", got)
	}

	if err := db.UpsertWorkspace(nil); err == nil {
		t.Fatal("expected error for nil workspace")
	}
}
