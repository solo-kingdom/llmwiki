package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// setupIntegrationRoutes wires all routes needed for the backend integration test.
func setupIntegrationRoutes(api *API, r chi.Router) {
	// Providers
	r.Get("/api/v1/providers", api.ListProviders)
	r.Get("/api/v1/providers/{id}/models", api.ListProviderModels)

	// Provider Instances
	r.Post("/api/v1/provider-instances", api.CreateProviderInstance)
	r.Get("/api/v1/provider-instances", api.ListProviderInstances)
	r.Get("/api/v1/provider-instances/{id}", api.GetProviderInstance)
	r.Put("/api/v1/provider-instances/{id}", api.UpdateProviderInstanceHandler)
	r.Delete("/api/v1/provider-instances/{id}", api.DeleteProviderInstanceHandler)

	// Settings
	r.Get("/api/v1/settings", api.GetSettings)
	r.Put("/api/v1/settings", api.UpdateSettings)
	r.Put("/api/v1/settings/last-model", api.UpdateLastModel)

	// Sessions
	r.Post("/api/v1/ingest/sessions", api.CreateIngestSession)
	r.Get("/api/v1/ingest/sessions", api.ListIngestSessionsHandler)
	r.Get("/api/v1/ingest/sessions/{id}", api.GetIngestSession)
	r.Patch("/api/v1/ingest/sessions/{id}", api.UpdateIngestSessionHandler)
	r.Post("/api/v1/ingest/sessions/{id}/messages", api.AppendIngestSessionMessage)
}

// TestBackendIntegration exercises the full flow:
// GET /providers → create instance → GET /models → create session → update session → verify config
func TestBackendIntegration(t *testing.T) {
	api, r := setupTestAPI(t)
	setupIntegrationRoutes(api, r)

	// Step 1: Seed provider cache (simulates models.dev sync)
	err := api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIBase: "https://api.openai.com/v1", APIFormat: "openai", EnvKey: "OPENAI_API_KEY"},
		{ID: "anthropic", Name: "Anthropic", APIBase: "https://api.anthropic.com", APIFormat: "anthropic", EnvKey: "ANTHROPIC_API_KEY"},
	})
	if err != nil {
		t.Fatalf("seed providers: %v", err)
	}

	err = api.db.UpsertModels([]sqlite.ModelInfo{
		{ProviderID: "openai", ModelID: "gpt-4o", Name: "GPT-4o", Family: "GPT-4", ContextLimit: 128000, OutputLimit: 16384, CostInput: 2.5, CostOutput: 10.0, Reasoning: true, ToolCall: true},
		{ProviderID: "openai", ModelID: "gpt-4o-mini", Name: "GPT-4o Mini", Family: "GPT-4", ContextLimit: 128000},
		{ProviderID: "anthropic", ModelID: "claude-3-5-sonnet", Name: "Claude 3.5 Sonnet", Family: "Claude", ContextLimit: 200000, Reasoning: true, ToolCall: true},
	})
	if err != nil {
		t.Fatalf("seed models: %v", err)
	}

	// Step 2: GET /providers — catalog listing (no key status)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list providers: %d %s", w.Code, w.Body.String())
	}

	var providers []providerResponse
	json.NewDecoder(w.Body).Decode(&providers)
	if len(providers) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(providers))
	}

	// Step 3: Create a provider instance for openai
	instBody, _ := json.Marshal(map[string]string{
		"name":       "OpenAI Work",
		"catalog_id": "openai",
		"api_key":    "sk-integration-test-key-12345678",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/provider-instances", bytes.NewReader(instBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create instance: %d %s", w.Code, w.Body.String())
	}

	var instResp instanceResponse
	json.NewDecoder(w.Body).Decode(&instResp)
	instanceID := instResp.Instance.ID
	if instanceID == "" {
		t.Fatal("expected instance ID")
	}
	if instResp.Instance.APIKey != "" {
		t.Error("API key should be masked in response")
	}
	if instResp.Instance.APIKeyMask == "" {
		t.Error("API key mask should be present")
	}

	// Step 4: GET /provider-instances — should list 1 instance
	req = httptest.NewRequest(http.MethodGet, "/api/v1/provider-instances", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var listResp instanceListResponse
	json.NewDecoder(w.Body).Decode(&listResp)
	if len(listResp.Instances) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(listResp.Instances))
	}

	// Step 5: GET /providers/openai/models
	req = httptest.NewRequest(http.MethodGet, "/api/v1/providers/openai/models", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list models: %d %s", w.Code, w.Body.String())
	}

	var models []modelResponse
	json.NewDecoder(w.Body).Decode(&models)
	if len(models) != 2 {
		t.Fatalf("expected 2 openai models, got %d", len(models))
	}

	// Step 6: Create session with instance_id/model
	sessionBody, _ := json.Marshal(map[string]string{
		"title":       "Integration Test Session",
		"instance_id": instanceID,
		"model":       "gpt-4o",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(sessionBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create session: %d %s", w.Code, w.Body.String())
	}

	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	sessionID := createResp.Session.ID
	if sessionID == "" {
		t.Fatal("expected session ID")
	}
	if createResp.Session.LLMInstanceID != instanceID {
		t.Errorf("instance_id = %q, want %q", createResp.Session.LLMInstanceID, instanceID)
	}
	if createResp.Session.LLMModel != "gpt-4o" {
		t.Errorf("model = %q, want gpt-4o", createResp.Session.LLMModel)
	}

	// Step 7: Verify global last_instance_id/last_model NOT set by create
	li, _ := api.db.GetConfig("last_instance_id")
	if li == instanceID {
		t.Error("last_instance_id should not be set by create session")
	}

	// Step 8: Update session instance → changes global last_instance_id
	patchBody, _ := json.Marshal(map[string]string{
		"instance_id": instanceID,
		"model":       "gpt-4o",
	})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/"+sessionID, bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("update session: %d %s", w.Code, w.Body.String())
	}

	li, _ = api.db.GetConfig("last_instance_id")
	if li != instanceID {
		t.Errorf("last_instance_id = %q, want %q (updated by PATCH)", li, instanceID)
	}
	lm, _ := api.db.GetConfig("last_model")
	if lm != "gpt-4o" {
		t.Errorf("last_model = %q, want gpt-4o (updated by PATCH)", lm)
	}

	// Step 9: GET /ingest/sessions — should list the session
	req = httptest.NewRequest(http.MethodGet, "/api/v1/ingest/sessions", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list sessions: %d %s", w.Code, w.Body.String())
	}

	var sessionsList map[string]interface{}
	json.NewDecoder(w.Body).Decode(&sessionsList)
	sessions, ok := sessionsList["sessions"].([]interface{})
	if !ok {
		t.Fatal("expected sessions array")
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}

	// Step 10: GET /settings — verify last_instance_id
	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get settings: %d %s", w.Code, w.Body.String())
	}

	var settings settingsResponse
	json.NewDecoder(w.Body).Decode(&settings)
	if settings.LastInstanceID != instanceID {
		t.Errorf("settings.last_instance_id = %q, want %q", settings.LastInstanceID, instanceID)
	}
	if settings.LastModel != "gpt-4o" {
		t.Errorf("settings.last_model = %q, want gpt-4o", settings.LastModel)
	}
}

// TestBackendIntegrationStreamingGuard verifies the stream guard logic:
// session without instance → 400, session with non-existent instance → 400
func TestBackendIntegrationStreamingGuard(t *testing.T) {
	api, r := setupTestAPI(t)
	setupIntegrationRoutes(api, r)

	// Seed provider
	api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIFormat: "openai", EnvKey: "OPENAI_API_KEY"},
	})

	// Create session without instance
	sessionBody, _ := json.Marshal(map[string]string{"title": "Guard Test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(sessionBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	// Try streaming — no instance → 400
	msgBody, _ := json.Marshal(map[string]string{"content": "hello"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1", bytes.NewReader(msgBody))
	req.Header.Set("Accept", "text/event-stream")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (no instance), got %d", w.Code)
	}

	// Update session to have non-existent instance
	patchBody, _ := json.Marshal(map[string]string{
		"instance_id": "inst_notexist",
		"model":       "gpt-4o",
	})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/"+createResp.Session.ID, bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Try streaming — no instance → 400
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1", bytes.NewReader(msgBody))
	req.Header.Set("Accept", "text/event-stream")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (no api key), got %d", w.Code)
	}
}
