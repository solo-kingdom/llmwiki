package sqlite

import "testing"

func TestVCConfigLastCommit(t *testing.T) {
	db := openTestDB(t)

	cfg := db.GetVCConfig()
	if cfg.LastCommit != "" {
		t.Errorf("expected empty last commit, got %q", cfg.LastCommit)
	}

	if err := db.SetVCLastCommit("abc123"); err != nil {
		t.Fatalf("SetVCLastCommit: %v", err)
	}
	cfg = db.GetVCConfig()
	if cfg.LastCommit != "abc123" {
		t.Errorf("expected last commit abc123, got %q", cfg.LastCommit)
	}
}
