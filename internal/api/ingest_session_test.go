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
		r.Get("/", api.ListIngestSessionsHandler)
		r.Get("/{id}", api.GetIngestSession)
		r.Patch("/{id}", api.UpdateIngestSessionHandler)
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

func TestCreateSessionWithInstanceModel(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	// Set global defaults
	api.db.SetConfig("last_instance_id", "inst_global12")
	api.db.SetConfig("last_model", "gpt-4o")

	// Create session with explicit instance/model
	body, _ := json.Marshal(map[string]string{
		"title":       "Custom Session",
		"instance_id": "inst_abc12345",
		"model":       "claude-3",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	var resp sessionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Session == nil {
		t.Fatal("expected session")
	}
	if resp.Session.LLMInstanceID != "inst_abc12345" {
		t.Errorf("instance_id = %q, want inst_abc12345", resp.Session.LLMInstanceID)
	}
	if resp.Session.LLMModel != "claude-3" {
		t.Errorf("model = %q, want claude-3", resp.Session.LLMModel)
	}
}

func TestCreateSessionFallsBackToGlobalConfig(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	// Set global defaults
	api.db.SetConfig("last_instance_id", "inst_global12")
	api.db.SetConfig("last_model", "gpt-4o")

	// Create session without instance/model
	body, _ := json.Marshal(map[string]string{
		"title": "Default Session",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	var resp sessionResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Session.LLMInstanceID != "inst_global12" {
		t.Errorf("instance_id = %q, want inst_global12 (from global)", resp.Session.LLMInstanceID)
	}
	if resp.Session.LLMModel != "gpt-4o" {
		t.Errorf("model = %q, want gpt-4o (from global)", resp.Session.LLMModel)
	}
}

func TestCreateSessionNoInstanceNoGlobal(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	// No global defaults set, no instance/model in request
	body, _ := json.Marshal(map[string]string{
		"title": "Empty Session",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	var resp sessionResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Session.LLMInstanceID != "" {
		t.Errorf("instance_id = %q, want empty", resp.Session.LLMInstanceID)
	}
	if resp.Session.LLMModel != "" {
		t.Errorf("model = %q, want empty", resp.Session.LLMModel)
	}
}

func TestListSessionsHandler(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	for _, title := range []string{"Session A", "Session B"} {
		body, _ := json.Marshal(map[string]string{"title": title})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("create %s: %d", title, w.Code)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	sessions, ok := resp["sessions"].([]interface{})
	if !ok {
		t.Fatal("expected sessions array")
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestListSessionsEmpty(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	sessions, ok := resp["sessions"].([]interface{})
	if !ok {
		t.Fatal("expected sessions array")
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestUpdateSessionInstanceModel(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	body, _ := json.Marshal(map[string]string{"title": "Test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	sessionID := createResp.Session.ID

	// Update instance/model
	patchBody, _ := json.Marshal(map[string]string{
		"instance_id": "inst_groq1234",
		"model":       "llama-3.1-70b",
	})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/"+sessionID, bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("update: %d %s", w.Code, w.Body.String())
	}

	var updateResp sessionResponse
	json.NewDecoder(w.Body).Decode(&updateResp)
	if updateResp.Session.LLMInstanceID != "inst_groq1234" {
		t.Errorf("instance_id = %q, want inst_groq1234", updateResp.Session.LLMInstanceID)
	}
	if updateResp.Session.LLMModel != "llama-3.1-70b" {
		t.Errorf("model = %q, want llama-3.1-70b", updateResp.Session.LLMModel)
	}

	// Verify global last_instance_id/last_model updated
	li, _ := api.db.GetConfig("last_instance_id")
	if li != "inst_groq1234" {
		t.Errorf("last_instance_id = %q, want inst_groq1234", li)
	}
	lm, _ := api.db.GetConfig("last_model")
	if lm != "llama-3.1-70b" {
		t.Errorf("last_model = %q, want llama-3.1-70b", lm)
	}
}

func TestUpdateSessionTitle(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	body, _ := json.Marshal(map[string]string{"title": "Original"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	sessionID := createResp.Session.ID

	patchBody, _ := json.Marshal(map[string]string{
		"title": "Updated Title",
	})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/"+sessionID, bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("update: %d %s", w.Code, w.Body.String())
	}

	var updateResp sessionResponse
	json.NewDecoder(w.Body).Decode(&updateResp)
	if updateResp.Session.Title != "Updated Title" {
		t.Errorf("title = %q, want Updated Title", updateResp.Session.Title)
	}
}

func TestUpdateSessionNoFields(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	body, _ := json.Marshal(map[string]string{"title": "Test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	patchBody, _ := json.Marshal(map[string]string{})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/"+createResp.Session.ID, bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSessionNotFound(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	patchBody, _ := json.Marshal(map[string]string{
		"instance_id": "inst_openai1",
	})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/nonexistent-id", bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestStreamSessionReplyNoInstance(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	body, _ := json.Marshal(map[string]string{"title": "No Instance"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	msgBody, _ := json.Marshal(map[string]string{"content": "hello"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1", bytes.NewReader(msgBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (no instance), got %d; body=%s", w.Code, w.Body.String())
	}
}

func TestStreamSessionReplyNoAPIKey(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	// Create session with instance/model but no actual provider instance with API key
	body, _ := json.Marshal(map[string]string{
		"title":       "No Key",
		"instance_id": "inst_notexist",
		"model":       "gpt-4o",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	msgBody, _ := json.Marshal(map[string]string{"content": "hello"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1", bytes.NewReader(msgBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (no api key), got %d; body=%s", w.Code, w.Body.String())
	}
}
