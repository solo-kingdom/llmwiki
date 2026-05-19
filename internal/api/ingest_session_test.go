package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
)

func setupSessionRoutes(api *API, r chi.Router) {
	r.Route("/api/v1/ingest/sessions", func(r chi.Router) {
		r.Post("/", api.CreateIngestSession)
		r.Get("/{id}", api.GetIngestSession)
		r.Get("/{id}/messages", api.ListIngestSessionMessages)
		r.Post("/{id}/messages", api.AppendIngestSessionMessage)
		r.Post("/{id}/archive", api.ArchiveIngestSession)
	})
}

func TestIngestSessionCRUDAndArchive(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	// Create session
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader([]byte(`{"title":"Topic A"}`)))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create session: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.Session.ID == "" {
		t.Fatal("expected session id")
	}

	// Archive empty -> 400
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/archive", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("archive empty: expected 400, got %d", w.Code)
	}

	// Append user message (non-stream)
	body, _ := json.Marshal(map[string]string{"content": "hello wiki"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/messages", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("append message: %d %s", w.Code, w.Body.String())
	}

	// Archive succeeds
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/archive", bytes.NewReader([]byte(`{"title":"Final"}`)))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("archive: %d %s", w.Code, w.Body.String())
	}
	var arch struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(w.Body).Decode(&arch); err != nil {
		t.Fatal(err)
	}
	if arch.JobID == "" {
		t.Fatal("expected job id")
	}

	// Unknown session -> 404
	req = httptest.NewRequest(http.MethodGet, "/api/v1/ingest/sessions/nope/messages", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestIngestSessionArchivePersistsFile(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)
	dir := api.workspace

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var created struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	_ = json.NewDecoder(w.Body).Decode(&created)

	body, _ := json.Marshal(map[string]string{"content": "note"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/messages", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/archive", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("archive: %d", w.Code)
	}

	glob, _ := filepath.Glob(filepath.Join(dir, "raw/sources/web-ingest/sessions", created.Session.ID, "archive-*.md"))
	if len(glob) == 0 {
		t.Fatal("expected archive markdown on disk")
	}
}
