package sqlite

import (
	"testing"
)

func TestVCConfigReadWrite(t *testing.T) {
	db := openTestDB(t)

	// Default: not enabled
	cfg := db.GetVCConfig()
	if cfg.Enabled {
		t.Error("expected vc_enabled to be false by default")
	}
	if cfg.LastCommit != "" {
		t.Error("expected empty last_commit by default")
	}

	// Enable
	if err := db.SetVCEnabled(true); err != nil {
		t.Fatalf("SetVCEnabled(true): %v", err)
	}
	cfg = db.GetVCConfig()
	if !cfg.Enabled {
		t.Error("expected vc_enabled to be true")
	}

	// Disable
	if err := db.SetVCEnabled(false); err != nil {
		t.Fatalf("SetVCEnabled(false): %v", err)
	}
	cfg = db.GetVCConfig()
	if cfg.Enabled {
		t.Error("expected vc_enabled to be false")
	}

	// Set last commit
	if err := db.SetVCLastCommit("abc123"); err != nil {
		t.Fatalf("SetVCLastCommit: %v", err)
	}
	cfg = db.GetVCConfig()
	if cfg.LastCommit != "abc123" {
		t.Errorf("expected last_commit 'abc123', got %q", cfg.LastCommit)
	}
}
