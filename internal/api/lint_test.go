package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/engine"
)

func TestLintAPI(t *testing.T) {
	root := t.TempDir()
	wikiDir := filepath.Join(root, "wiki", "entities")
	if err := os.MkdirAll(wikiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	page := `---
title: Test
type: entity
date: "2024-01-01"
---
# Test
`
	if err := os.WriteFile(filepath.Join(wikiDir, "ok.md"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	logContent := `---
title: Log
---
## [2024-01-01] init | ok
`
	if err := os.WriteFile(filepath.Join(root, "wiki", "log.md"), []byte(logContent), 0o644); err != nil {
		t.Fatal(err)
	}

	api := New(nil)
	api.SetWorkspace(root)

	r := chi.NewRouter()
	r.Get("/api/v1/lint", api.Lint)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}

	var report engine.LintReport
	if err := json.NewDecoder(w.Body).Decode(&report); err != nil {
		t.Fatal(err)
	}
	if report.Issues == nil {
		t.Fatal("expected issues array")
	}
	if report.Stats.PageCount == 0 {
		t.Fatal("expected page count > 0")
	}
}
