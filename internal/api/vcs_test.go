package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

func setupVCSTest(t *testing.T) (*API, string) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	// Create workspace with wiki/
	ws := t.TempDir()
	os.MkdirAll(filepath.Join(ws, "wiki"), 0o755)

	api := New(db)
	api.SetWorkspace(ws)
	return api, ws
}

func TestVCSStatusWithoutGit(t *testing.T) {
	api, _ := setupVCSTest(t)

	req := httptest.NewRequest("GET", "/api/v1/vcs/status", nil)
	w := httptest.NewRecorder()
	api.VCSStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var status VCStatus
	if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if status.Enabled {
		t.Error("expected enabled=false when no .git exists")
	}
	if status.CommitCount != 0 {
		t.Error("expected 0 commits")
	}
	// Git should be available in test env
	if !status.GitAvailable {
		t.Log("git not available in test environment")
	}
}

func TestVCSInitAndStatus(t *testing.T) {
	if !vcs.IsGitAvailable().Available {
		t.Skip("git not available")
	}

	api, ws := setupVCSTest(t)

	// Write a wiki file
	os.WriteFile(filepath.Join(ws, "wiki", "test.md"), []byte("# Test"), 0o644)

	// Init
	req := httptest.NewRequest("POST", "/api/v1/vcs/init", nil)
	w := httptest.NewRecorder()
	api.VCSInit(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("init status = %d, body: %s", w.Code, w.Body.String())
	}

	var initResp VCInitResponse
	if err := json.NewDecoder(w.Body).Decode(&initResp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if initResp.Status != "initialized" {
		t.Errorf("status = %q, want 'initialized'", initResp.Status)
	}
	if initResp.CommitCount != 1 {
		t.Errorf("commit_count = %d, want 1", initResp.CommitCount)
	}

	// Status should now show enabled
	req = httptest.NewRequest("GET", "/api/v1/vcs/status", nil)
	w = httptest.NewRecorder()
	api.VCSStatus(w, req)

	var status VCStatus
	json.NewDecoder(w.Body).Decode(&status)
	if !status.Enabled {
		t.Error("expected enabled=true after init")
	}
	if status.CommitCount < 1 {
		t.Error("expected at least 1 commit")
	}
}

func TestVCSInitAlreadyInitialized(t *testing.T) {
	if !vcs.IsGitAvailable().Available {
		t.Skip("git not available")
	}

	api, _ := setupVCSTest(t)

	// First init
	req := httptest.NewRequest("POST", "/api/v1/vcs/init", nil)
	w := httptest.NewRecorder()
	api.VCSInit(w, req)

	// Second init
	req = httptest.NewRequest("POST", "/api/v1/vcs/init", nil)
	w = httptest.NewRecorder()
	api.VCSInit(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("second init status = %d", w.Code)
	}

	var resp VCInitResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Status != "already_initialized" {
		t.Errorf("status = %q, want 'already_initialized'", resp.Status)
	}
}

func TestVCSDisable(t *testing.T) {
	api, _ := setupVCSTest(t)

	req := httptest.NewRequest("POST", "/api/v1/vcs/disable", nil)
	w := httptest.NewRecorder()
	api.VCSDisable(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("disable status = %d", w.Code)
	}
}

func TestVCSLogEmpty(t *testing.T) {
	api, _ := setupVCSTest(t)

	req := httptest.NewRequest("GET", "/api/v1/vcs/log", nil)
	w := httptest.NewRecorder()
	api.VCSLog(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("log status = %d", w.Code)
	}

	var entries []VCLogEntry
	json.NewDecoder(w.Body).Decode(&entries)
	if len(entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(entries))
	}
}

func TestVCSRollbackNoSHA(t *testing.T) {
	api, _ := setupVCSTest(t)

	req := httptest.NewRequest("POST", "/api/v1/ingest/rollback", nil)
	w := httptest.NewRecorder()
	api.VCSRollback(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
