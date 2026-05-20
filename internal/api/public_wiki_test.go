package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func mountPublicWikiRoutes(r *chi.Mux, api *API) {
	r.Get("/api/public/wiki/status", api.PublicWikiStatus)
	r.Get("/api/public/wiki/documents", api.ListPublicWikiDocuments)
	r.Route("/api/public/wiki/documents/{id}", func(r chi.Router) {
		r.Get("/", api.GetPublicWikiDocument)
	})
	r.Get("/api/public/wiki/search", api.SearchPublicWiki)
}

func setupPublicWikiRouter(t *testing.T, publicEnabled bool, withToken bool) (*chi.Mux, string) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	api := New(db)
	api.SetPublicWikiEnabled(publicEnabled)
	r := chi.NewRouter()

	token := ""
	if withToken {
		token = "test-secret"
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if req.URL.Path == "/api/v1/health" || req.URL.Path == "/api/public/wiki/status" {
					next.ServeHTTP(w, req)
					return
				}
				if publicEnabled && len(req.URL.Path) >= len("/api/public/wiki/") &&
					req.URL.Path[:len("/api/public/wiki/")] == "/api/public/wiki/" {
					next.ServeHTTP(w, req)
					return
				}
				auth := req.Header.Get("Authorization")
				if auth != "Bearer "+token {
					http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
					return
				}
				next.ServeHTTP(w, req)
			})
		})
	}

	mountPublicWikiRoutes(r, api)
	r.Get("/api/v1/settings", api.GetSettings)

	return r, token
}

func TestPublicWikiStatus(t *testing.T) {
	api, r := setupTestAPI(t)
	api.SetPublicWikiEnabled(true)
	r.Get("/api/public/wiki/status", api.PublicWikiStatus)

	req := httptest.NewRequest(http.MethodGet, "/api/public/wiki/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]bool
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp["enabled"] {
		t.Error("expected enabled=true")
	}
}

func TestPublicWikiDisabledReturnsForbidden(t *testing.T) {
	r, _ := setupPublicWikiRouter(t, false, false)

	req := httptest.NewRequest(http.MethodGet, "/api/public/wiki/documents", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestPublicWikiEnabledListWithoutToken(t *testing.T) {
	r, _ := setupPublicWikiRouter(t, true, true)

	req := httptest.NewRequest(http.MethodGet, "/api/public/wiki/documents", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
}

func TestManagementAPIStillRequiresTokenWhenPublicWikiEnabled(t *testing.T) {
	r, token := setupPublicWikiRouter(t, true, true)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated settings status = %d, want 401", w.Code)
	}

	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("authenticated settings status = %d, want 200", w2.Code)
	}
}

func TestPublicWikiDocumentExcludesSensitiveFields(t *testing.T) {
	api, r := setupTestAPI(t)
	api.SetPublicWikiEnabled(true)
	mountPublicWikiRoutes(r, api)
	r.Post("/api/v1/documents", api.CreateDocument)

	body := []byte(`{"filename":"pub.md","path":"/wiki","content":"# Hello","title":"Hello"}`)
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createW := httptest.NewRecorder()
	r.ServeHTTP(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("create status = %d", createW.Code)
	}
	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(createW.Body).Decode(&created)

	getReq := httptest.NewRequest(http.MethodGet, "/api/public/wiki/documents/"+created.ID, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("get status = %d, body=%s", getW.Code, getW.Body.String())
	}

	var payload map[string]json.RawMessage
	json.NewDecoder(getW.Body).Decode(&payload)
	for _, key := range []string{"user_id", "error_message", "content_hash", "metadata"} {
		if _, ok := payload[key]; ok {
			t.Errorf("public document must not include %q", key)
		}
	}
}
