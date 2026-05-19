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

type testCreateRequest struct {
	Filename   string   `json:"filename"`
	Path       string   `json:"path"`
	Content    string   `json:"content"`
	Title      string   `json:"title"`
	SourceKind string   `json:"source_kind"`
	Tags       []string `json:"tags"`
}

func setupTestAPI(t *testing.T) (*API, *chi.Mux) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	api := New(db, nil)
	r := chi.NewRouter()

	r.Get("/api/v1/health", api.Health)
	r.Get("/api/v1/documents", api.ListDocuments)
	r.Post("/api/v1/documents", api.CreateDocument)
	r.Route("/api/v1/documents/{id}", func(r chi.Router) {
		r.Get("/", api.GetDocument)
		r.Put("/content", api.UpdateDocumentContent)
		r.Delete("/", api.DeleteDocument)
	})
	r.Get("/api/v1/search", api.Search)
	r.Route("/api/v1/graph", func(r chi.Router) {
		r.Get("/uncited", api.UncitedSources)
		r.Get("/stale", api.StalePages)
		r.Get("/{id}/backlinks", api.Backlinks)
		r.Get("/{id}/forward", api.ForwardReferences)
	})

	return api, r
}

func (a *API) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func TestHealthEndpoint(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["status"] != "ok" {
		t.Errorf("expected status ok, got %q", resp["status"])
	}
}

func TestListDocumentsEmpty(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
}

func TestCreateAndGetDocument(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "test.md",
		Path:     "/wiki",
		Content:  "# Hello World",
		Title:    "Test",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d; body: %s", w.Code, w.Body.String())
	}

	var created sqlite.Document
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.Filename != "test.md" {
		t.Errorf("expected filename 'test.md', got %q", created.Filename)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+created.ID, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", getW.Code)
	}

	var fetched sqlite.Document
	if err := json.NewDecoder(getW.Body).Decode(&fetched); err != nil {
		t.Fatalf("decode fetched: %v", err)
	}
	if fetched.Filename != "test.md" {
		t.Errorf("expected filename 'test.md', got %q", fetched.Filename)
	}
}

func TestCreateDocumentMissingFilename(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Content: "some content",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestUpdateDocumentContent(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "update.md",
		Path:     "/wiki",
		Content:  "original",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var created sqlite.Document
	json.NewDecoder(w.Body).Decode(&created)

	updateBody, _ := json.Marshal(updateContentRequest{Content: "updated content"})
	upReq := httptest.NewRequest(http.MethodPut, "/api/v1/documents/"+created.ID+"/content", bytes.NewReader(updateBody))
	upReq.Header.Set("Content-Type", "application/json")
	upW := httptest.NewRecorder()
	r.ServeHTTP(upW, upReq)

	if upW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d; body: %s", upW.Code, upW.Body.String())
	}
}

func TestDeleteDocument(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "delete-me.md",
		Path:     "/wiki",
		Content:  "to be deleted",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var created sqlite.Document
	json.NewDecoder(w.Body).Decode(&created)

	delReq := httptest.NewRequest(http.MethodDelete, "/api/v1/documents/"+created.ID, nil)
	delW := httptest.NewRecorder()
	r.ServeHTTP(delW, delReq)

	if delW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", delW.Code)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+created.ID, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusNotFound {
		t.Errorf("expected status 404 after delete, got %d", getW.Code)
	}
}

func TestGetDocumentNotFound(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/nonexistent-id", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestSearchEndpoint(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "searchable.md",
		Path:     "/wiki",
		Content:  "Machine learning and neural networks",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	searchReq := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=machine+learning&limit=5", nil)
	searchW := httptest.NewRecorder()
	r.ServeHTTP(searchW, searchReq)

	if searchW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d; body: %s", searchW.Code, searchW.Body.String())
	}
}

func TestSearchMissingQuery(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestGraphEndpoints(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "graph-test.md",
		Path:     "/wiki",
		Content:  "test",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var created sqlite.Document
	json.NewDecoder(w.Body).Decode(&created)

	blReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/"+created.ID+"/backlinks", nil)
	blW := httptest.NewRecorder()
	r.ServeHTTP(blW, blReq)
	if blW.Code != http.StatusOK {
		t.Errorf("backlinks: expected status 200, got %d", blW.Code)
	}

	fwdReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/"+created.ID+"/forward", nil)
	fwdW := httptest.NewRecorder()
	r.ServeHTTP(fwdW, fwdReq)
	if fwdW.Code != http.StatusOK {
		t.Errorf("forward refs: expected status 200, got %d", fwdW.Code)
	}

	uncitedReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/uncited", nil)
	uncitedW := httptest.NewRecorder()
	r.ServeHTTP(uncitedW, uncitedReq)
	if uncitedW.Code != http.StatusOK {
		t.Errorf("uncited: expected status 200, got %d", uncitedW.Code)
	}

	staleReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/stale", nil)
	staleW := httptest.NewRecorder()
	r.ServeHTTP(staleW, staleReq)
	if staleW.Code != http.StatusOK {
		t.Errorf("stale: expected status 200, got %d", staleW.Code)
	}
}
