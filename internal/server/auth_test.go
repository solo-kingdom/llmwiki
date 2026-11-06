package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func authTestRouter(tokenFn func() string, publicWiki bool) http.Handler {
	r := chi.NewRouter()
	r.Use(authMiddleware(tokenFn, publicWiki))
	r.Get("/api/v1/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/api/v1/settings", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/api/public/wiki/status", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/api/public/wiki/documents", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	return r
}

func TestAuthMiddlewareDisabledWithoutToken(t *testing.T) {
	rec := httptest.NewRecorder()
	authTestRouter(func() string { return "" }, false).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 when no token is configured", rec.Code)
	}
}

func TestAuthMiddlewareReadsTokenPerRequest(t *testing.T) {
	token := ""
	r := authTestRouter(func() string { return token }, false)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 before a token is set", rec.Code)
	}

	token = "secret-token-123"
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 after a token is set", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	req.Header.Set("Authorization", "Bearer secret-token-123")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 with the token", rec.Code)
	}
}

func TestAuthMiddlewareExemptions(t *testing.T) {
	r := authTestRouter(func() string { return "secret-token-123" }, true)

	for _, path := range []string{"/api/v1/health", "/api/public/wiki/status", "/api/public/wiki/documents"} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200", path, rec.Code)
		}
	}

	// Public wiki routes stay unauthenticated only while the feature is enabled.
	r = authTestRouter(func() string { return "secret-token-123" }, false)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/public/wiki/documents", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("public wiki disabled: status = %d, want 401", rec.Code)
	}
}

func TestEffectiveAPITokenPrefersFlag(t *testing.T) {
	dir := t.TempDir()
	db, err := sqlite.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if err := db.SetConfig(sqlite.ConfigAPIToken, "stored-token-123"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}

	s := &Server{db: db}
	if got := s.effectiveAPIToken(); got != "stored-token-123" {
		t.Errorf("token = %q, want the stored one", got)
	}

	s.config.Token = "flag-token-123"
	if got := s.effectiveAPIToken(); got != "flag-token-123" {
		t.Errorf("token = %q, want the --token flag to win", got)
	}

	s.config.Token = ""
	if err := db.SetConfig(sqlite.ConfigAPIToken, ""); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}
	if got := s.effectiveAPIToken(); got != "" {
		t.Errorf("token = %q, want empty after clearing", got)
	}
}
