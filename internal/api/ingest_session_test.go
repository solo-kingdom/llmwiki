package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func setupSessionRoutes(api *API, r chi.Router) {
	r.Route("/api/v1/ingest/sessions", func(r chi.Router) {
		r.Post("/", api.CreateIngestSession)
		r.Get("/", api.ListIngestSessionsHandler)
		r.Get("/{id}", api.GetIngestSession)
		r.Patch("/{id}", api.UpdateIngestSessionHandler)
		r.Delete("/{id}", api.DeleteIngestSessionHandler)
		r.Get("/{id}/messages", api.ListIngestSessionMessages)
		r.Post("/{id}/messages", api.AppendIngestSessionMessage)
		r.Post("/{id}/messages/{messageId}/retry", api.RetryIngestSessionMessage)
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
		ReviewID string `json:"review_id"`
		Status   string `json:"status"`
	}
	if err := json.NewDecoder(w.Body).Decode(&arch); err != nil {
		t.Fatal(err)
	}
	if arch.ReviewID == "" {
		t.Fatal("expected review id")
	}
	if arch.Status != "planning" {
		t.Fatalf("expected planning status, got %q", arch.Status)
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

func TestCreateSessionDefaultTitle(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	var resp sessionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Session == nil {
		t.Fatal("expected session")
	}
	if !strings.HasPrefix(resp.Session.Title, "#1 ") {
		t.Errorf("title = %q, want prefix #1 ", resp.Session.Title)
	}
	if len(resp.Session.Title) < len("#1 2006-01-02") {
		t.Errorf("title = %q, expected date suffix", resp.Session.Title)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create second: %d %s", w.Code, w.Body.String())
	}
	json.NewDecoder(w.Body).Decode(&resp)
	if !strings.HasPrefix(resp.Session.Title, "#2 ") {
		t.Errorf("second title = %q, want prefix #2 ", resp.Session.Title)
	}
}

func TestCreateSessionDefaultTitleRespectsExplicitTitle(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	body, _ := json.Marshal(map[string]string{"title": "My Topic"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	var resp sessionResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Session.Title != "My Topic" {
		t.Errorf("title = %q, want My Topic", resp.Session.Title)
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

func TestDeleteIngestSession(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	body, _ := json.Marshal(map[string]string{"title": "To Delete"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	if err := json.NewDecoder(w.Body).Decode(&createResp); err != nil {
		t.Fatal(err)
	}
	sessionID := createResp.Session.ID

	msgBody, _ := json.Marshal(map[string]string{"content": "hello"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+sessionID+"/messages", bytes.NewReader(msgBody))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("append message: %d %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/ingest/sessions/"+sessionID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/ingest/sessions/"+sessionID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", w.Code)
	}

	sessionDir := filepath.Join(api.workspace, "raw/sources/web-ingest/sessions", sessionID)
	if _, err := os.Stat(sessionDir); !os.IsNotExist(err) {
		t.Fatalf("expected session dir removed, stat err=%v", err)
	}
}

func TestDeleteIngestSessionArchived(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader([]byte(`{"title":"Archived Chat"}`)))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	_ = json.NewDecoder(w.Body).Decode(&createResp)
	sessionID := createResp.Session.ID

	msgBody, _ := json.Marshal(map[string]string{"content": "archive me"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+sessionID+"/messages", bytes.NewReader(msgBody))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+sessionID+"/archive", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("archive: %d %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/ingest/sessions/"+sessionID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("delete archived: %d %s", w.Code, w.Body.String())
	}
}

func TestDeleteIngestSessionNotFound(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/ingest/sessions/nonexistent-id", nil)
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

func seedOpenAIProviderForStream(t *testing.T, api *API) {
	t.Helper()
	if err := api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{
			ID:        "openai",
			Name:      "OpenAI",
			APIBase:   "https://api.openai.com/v1",
			APIFormat: "openai",
			EnvKey:    "OPENAI_API_KEY",
		},
	}); err != nil {
		t.Fatalf("UpsertProviderInfo: %v", err)
	}
}

func openAIStreamChunk(content string) string {
	payload, _ := json.Marshal(map[string]interface{}{
		"choices": []map[string]interface{}{
			{"delta": map[string]string{"content": content}},
		},
	})
	return "data: " + string(payload) + "\n\n"
}

func TestStreamSessionReplyIncrementalPersist(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)
	seedOpenAIProviderForStream(t, api)

	streamDone := make(chan struct{})
	llmSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if !strings.HasSuffix(req.URL.Path, "/chat/completions") {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for _, tok := range []string{
			"hello ", "from ", "incremental ", "stream ",
			"with ", "enough ", "content ", "to ", "flush ",
		} {
			fmt.Fprint(w, openAIStreamChunk(tok))
			flusher.Flush()
			time.Sleep(20 * time.Millisecond)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
		close(streamDone)
	}))
	t.Cleanup(llmSrv.Close)

	inst := &sqlite.ProviderInstance{
		Name:      "Mock OpenAI",
		CatalogID: "openai",
		APIKey:    "sk-test",
		BaseURL:   llmSrv.URL + "/v1",
	}
	if err := api.db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"title":       "Stream Test",
		"instance_id": inst.ID,
		"model":       "gpt-4o",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	if err := json.NewDecoder(w.Body).Decode(&createResp); err != nil {
		t.Fatal(err)
	}

	msgBody, _ := json.Marshal(map[string]string{"content": "hello"})
	streamReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1",
		bytes.NewReader(msgBody),
	)
	streamReq.Header.Set("Content-Type", "application/json")
	streamReq.Header.Set("Accept", "text/event-stream")

	handlerDone := make(chan struct{})
	go func() {
		defer close(handlerDone)
		streamW := httptest.NewRecorder()
		r.ServeHTTP(streamW, streamReq)
	}()

	deadline := time.Now().Add(3 * time.Second)
	var sawPartial bool
	for time.Now().Before(deadline) {
		msgs, err := api.db.ListIngestSessionMessages(createResp.Session.ID)
		if err != nil {
			t.Fatalf("ListIngestSessionMessages: %v", err)
		}
		for _, m := range msgs {
			if m.Role == "assistant" && m.StreamStatus == "streaming" && strings.Contains(m.Content, "incremental") {
				sawPartial = true
				break
			}
		}
		if sawPartial {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !sawPartial {
		t.Fatal("expected partial assistant content persisted while streaming")
	}

	select {
	case <-streamDone:
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not finish")
	}
	select {
	case <-handlerDone:
	case <-time.After(5 * time.Second):
		t.Fatal("stream handler did not finish")
	}

	msgs, err := api.db.ListIngestSessionMessages(createResp.Session.ID)
	if err != nil {
		t.Fatalf("ListIngestSessionMessages: %v", err)
	}
	var assistant *sqlite.IngestSessionMessage
	for i := range msgs {
		if msgs[i].Role == "assistant" {
			assistant = &msgs[i]
			break
		}
	}
	if assistant == nil {
		t.Fatal("expected assistant message")
	}
	if assistant.StreamStatus != "complete" {
		t.Fatalf("stream_status = %q, want complete", assistant.StreamStatus)
	}
	if !strings.Contains(assistant.Content, "incremental stream") {
		t.Fatalf("content = %q, want full streamed text", assistant.Content)
	}
}

func TestStreamSessionReplyClientDisconnectMarksIncomplete(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)
	seedOpenAIProviderForStream(t, api)

	release := make(chan struct{})
	llmSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		fmt.Fprint(w, openAIStreamChunk("partial "))
		flusher.Flush()
		<-release
		fmt.Fprint(w, openAIStreamChunk("rest"))
		flusher.Flush()
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	t.Cleanup(llmSrv.Close)

	inst := &sqlite.ProviderInstance{
		Name:      "Mock OpenAI",
		CatalogID: "openai",
		APIKey:    "sk-test",
		BaseURL:   llmSrv.URL + "/v1",
	}
	if err := api.db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"title":       "Disconnect Test",
		"instance_id": inst.ID,
		"model":       "gpt-4o",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	_ = json.NewDecoder(w.Body).Decode(&createResp)

	msgBody, _ := json.Marshal(map[string]string{"content": "hello"})
	streamReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1",
		bytes.NewReader(msgBody),
	)
	streamReq.Header.Set("Content-Type", "application/json")
	streamReq.Header.Set("Accept", "text/event-stream")
	ctx, cancel := context.WithCancel(streamReq.Context())
	defer cancel()
	streamReq = streamReq.WithContext(ctx)

	done := make(chan struct{})
	go func() {
		streamW := httptest.NewRecorder()
		r.ServeHTTP(streamW, streamReq)
		close(done)
	}()

	time.Sleep(80 * time.Millisecond)
	cancel()
	close(release)

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("stream handler did not return after client disconnect")
	}

	msgs, err := api.db.ListIngestSessionMessages(createResp.Session.ID)
	if err != nil {
		t.Fatalf("ListIngestSessionMessages: %v", err)
	}
	var assistant *sqlite.IngestSessionMessage
	for i := range msgs {
		if msgs[i].Role == "assistant" {
			assistant = &msgs[i]
			break
		}
	}
	if assistant == nil {
		t.Fatal("expected assistant message")
	}
	if assistant.StreamStatus != "incomplete" {
		t.Fatalf("stream_status = %q, want incomplete", assistant.StreamStatus)
	}
	if !strings.Contains(assistant.Content, "partial") {
		t.Fatalf("content = %q, want partial persisted text", assistant.Content)
	}
}

func TestRetryIngestSessionMessageReusesSameRows(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)
	seedOpenAIProviderForStream(t, api)

	llmSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		fmt.Fprint(w, openAIStreamChunk("retry success"))
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	t.Cleanup(llmSrv.Close)

	inst := &sqlite.ProviderInstance{
		Name:      "Mock OpenAI",
		CatalogID: "openai",
		APIKey:    "sk-test",
		BaseURL:   llmSrv.URL + "/v1",
	}
	if err := api.db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"title":       "Retry Test",
		"instance_id": inst.ID,
		"model":       "gpt-4o",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	if err := json.NewDecoder(w.Body).Decode(&createResp); err != nil {
		t.Fatal(err)
	}

	userMsg := &sqlite.IngestSessionMessage{
		SessionID:    createResp.Session.ID,
		Role:         "user",
		Content:      "hello retry",
		MessageType:  "text",
		StreamStatus: "complete",
	}
	if err := api.db.CreateIngestSessionMessage(userMsg); err != nil {
		t.Fatalf("CreateIngestSessionMessage user: %v", err)
	}

	assistant := &sqlite.IngestSessionMessage{
		SessionID:    createResp.Session.ID,
		Role:         "assistant",
		Content:      "LLM stream failed",
		MessageType:  "text",
		StreamStatus: "failed",
	}
	if err := api.db.CreateIngestSessionMessage(assistant); err != nil {
		t.Fatalf("CreateIngestSessionMessage assistant: %v", err)
	}
	assistantID := assistant.ID

	retryReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages/"+assistantID+"/retry?stream=1",
		nil,
	)
	retryReq.Header.Set("Accept", "text/event-stream")
	retryW := httptest.NewRecorder()
	r.ServeHTTP(retryW, retryReq)
	if retryW.Code != http.StatusOK {
		t.Fatalf("retry: expected 200, got %d; body=%s", retryW.Code, retryW.Body.String())
	}

	msgs, err := api.db.ListIngestSessionMessages(createResp.Session.ID)
	if err != nil {
		t.Fatalf("ListIngestSessionMessages: %v", err)
	}
	userCount := 0
	var retried *sqlite.IngestSessionMessage
	for i := range msgs {
		if msgs[i].Role == "user" {
			userCount++
		}
		if msgs[i].ID == assistantID {
			retried = &msgs[i]
		}
	}
	if userCount != 1 {
		t.Fatalf("user message count = %d, want 1 (no duplicate user on retry)", userCount)
	}
	if retried == nil {
		t.Fatal("expected same assistant message id after retry")
	}
	if retried.StreamStatus != "complete" {
		t.Fatalf("stream_status = %q, want complete", retried.StreamStatus)
	}
	if !strings.Contains(retried.Content, "retry success") {
		t.Fatalf("content = %q, want retry success", retried.Content)
	}
	if len(msgs) != 2 {
		t.Fatalf("message count = %d, want 2 (user + assistant only)", len(msgs))
	}
}

func TestRetryIngestSessionMessageNotRetriable(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSessionRoutes(api, r)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	_ = json.NewDecoder(w.Body).Decode(&createResp)

	assistant := &sqlite.IngestSessionMessage{
		SessionID:    createResp.Session.ID,
		Role:         "assistant",
		Content:      "done",
		MessageType:  "text",
		StreamStatus: "complete",
	}
	if err := api.db.CreateIngestSessionMessage(assistant); err != nil {
		t.Fatalf("CreateIngestSessionMessage: %v", err)
	}

	retryReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages/"+assistant.ID+"/retry?stream=1",
		nil,
	)
	retryReq.Header.Set("Accept", "text/event-stream")
	retryW := httptest.NewRecorder()
	r.ServeHTTP(retryW, retryReq)
	if retryW.Code != http.StatusBadRequest {
		t.Fatalf("retry complete assistant: expected 400, got %d; body=%s", retryW.Code, retryW.Body.String())
	}
}
