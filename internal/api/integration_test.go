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

	// Settings
	r.Get("/api/v1/settings", api.GetSettings)
	r.Put("/api/v1/settings", api.UpdateSettings)
	r.Put("/api/v1/settings/last-model", api.UpdateLastModel)
	r.Put("/api/v1/settings/provider-keys/{id}", api.UpdateProviderKey)

	// Sessions
	r.Post("/api/v1/ingest/sessions", api.CreateIngestSession)
	r.Get("/api/v1/ingest/sessions", api.ListIngestSessionsHandler)
	r.Get("/api/v1/ingest/sessions/{id}", api.GetIngestSession)
	r.Patch("/api/v1/ingest/sessions/{id}", api.UpdateIngestSessionHandler)
	r.Post("/api/v1/ingest/sessions/{id}/messages", api.AppendIngestSessionMessage)
}

// TestBackendIntegration exercises the full flow:
// GET /providers → set API key → GET /models → create session → update session → verify config
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

	// Step 2: GET /providers — initially no keys
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
	for _, p := range providers {
		if p.HasKey {
			t.Errorf("provider %s should not have key initially", p.ID)
		}
	}

	// Step 3: Set API key for openai
	keyBody, _ := json.Marshal(map[string]string{
		"api_key": "sk-integration-test-key-12345678",
	})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/settings/provider-keys/openai", bytes.NewReader(keyBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("set provider key: %d %s", w.Code, w.Body.String())
	}

	// Step 4: GET /providers — openai now has key
	req = httptest.NewRequest(http.MethodGet, "/api/v1/providers", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	json.NewDecoder(w.Body).Decode(&providers)
	for _, p := range providers {
		if p.ID == "openai" && !p.HasKey {
			t.Error("openai should have key after setting it")
		}
		if p.ID == "anthropic" && p.HasKey {
			t.Error("anthropic should not have key")
		}
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

	// Step 6: Create session with provider/model
	sessionBody, _ := json.Marshal(map[string]string{
		"title":    "Integration Test Session",
		"provider": "openai",
		"model":    "gpt-4o",
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
	if createResp.Session.LLMProvider != "openai" {
		t.Errorf("provider = %q, want openai", createResp.Session.LLMProvider)
	}
	if createResp.Session.LLMModel != "gpt-4o" {
		t.Errorf("model = %q, want gpt-4o", createResp.Session.LLMModel)
	}

	// Step 7: Verify global last_provider/last_model NOT set by create
	// (only set by PATCH update)
	lp, _ := api.db.GetConfig("last_provider")
	if lp == "openai" {
		t.Error("last_provider should not be set by create session")
	}

	// Step 8: Update session provider → changes global last_provider
	patchBody, _ := json.Marshal(map[string]string{
		"provider": "openai",
		"model":    "gpt-4o",
	})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/"+sessionID, bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("update session: %d %s", w.Code, w.Body.String())
	}

	lp, _ = api.db.GetConfig("last_provider")
	if lp != "openai" {
		t.Errorf("last_provider = %q, want openai (updated by PATCH)", lp)
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

	var listResp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&listResp)
	sessions, ok := listResp["sessions"].([]interface{})
	if !ok {
		t.Fatal("expected sessions array")
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}

	// Step 10: GET /settings — verify provider key status
	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get settings: %d %s", w.Code, w.Body.String())
	}

	var settings settingsResponse
	json.NewDecoder(w.Body).Decode(&settings)
	if settings.LastProvider != "openai" {
		t.Errorf("settings.last_provider = %q, want openai", settings.LastProvider)
	}
	if settings.LastModel != "gpt-4o" {
		t.Errorf("settings.last_model = %q, want gpt-4o", settings.LastModel)
	}
	openaiKey, ok := settings.ProviderKeys["openai"]
	if !ok {
		t.Fatal("openai provider key not in settings")
	}
	if !openaiKey.Has {
		t.Error("openai should have key in settings")
	}
	if openaiKey.Masked == "" {
		t.Error("openai masked key should not be empty")
	}
}

// TestBackendIntegrationStreamingGuard verifies the stream guard logic:
// session without provider → 400, session without key → 400
func TestBackendIntegrationStreamingGuard(t *testing.T) {
	api, r := setupTestAPI(t)
	setupIntegrationRoutes(api, r)

	// Seed provider
	api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIFormat: "openai", EnvKey: "OPENAI_API_KEY"},
	})

	// Create session without provider
	sessionBody, _ := json.Marshal(map[string]string{"title": "Guard Test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", bytes.NewReader(sessionBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var createResp sessionResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	// Try streaming — no provider → 400
	msgBody, _ := json.Marshal(map[string]string{"content": "hello"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1", bytes.NewReader(msgBody))
	req.Header.Set("Accept", "text/event-stream")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (no provider), got %d", w.Code)
	}

	// Update session to have provider/model but no key
	patchBody, _ := json.Marshal(map[string]string{
		"provider": "openai",
		"model":    "gpt-4o",
	})
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/ingest/sessions/"+createResp.Session.ID, bytes.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Try streaming — no key → 400
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+createResp.Session.ID+"/messages?stream=1", bytes.NewReader(msgBody))
	req.Header.Set("Accept", "text/event-stream")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (no api key), got %d", w.Code)
	}

	// Set API key — now it should proceed (but will fail on actual LLM call, which is fine)
	api.db.SetProviderKey("openai", "sk-test-key-for-guard-test", "")
}
