package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func setupProviderRoutes(api *API, r chi.Router) {
	r.Get("/api/v1/providers", api.ListProviders)
	r.Get("/api/v1/providers/{id}/models", api.ListProviderModels)
}

func TestListProvidersEmpty(t *testing.T) {
	api, r := setupTestAPI(t)
	setupProviderRoutes(api, r)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var providers []providerResponse
	if err := json.NewDecoder(w.Body).Decode(&providers); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(providers) != 0 {
		t.Errorf("expected empty providers, got %d", len(providers))
	}
}

func TestListProvidersWithData(t *testing.T) {
	api, r := setupTestAPI(t)
	setupProviderRoutes(api, r)

	// Seed provider cache
	err := api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIBase: "https://api.openai.com/v1", APIFormat: "openai", EnvKey: "OPENAI_API_KEY", DocURL: "https://platform.openai.com"},
		{ID: "anthropic", Name: "Anthropic", APIBase: "https://api.anthropic.com", APIFormat: "anthropic", EnvKey: "ANTHROPIC_API_KEY", DocURL: "https://docs.anthropic.com"},
	})
	if err != nil {
		t.Fatalf("seed providers: %v", err)
	}

	// Set key for openai only
	if err := api.db.SetProviderKey("openai", "sk-test-key-12345678", ""); err != nil {
		t.Fatalf("set provider key: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var providers []providerResponse
	if err := json.NewDecoder(w.Body).Decode(&providers); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(providers) != 2 {
		t.Fatalf("expected 2 providers, got %d", len(providers))
	}

	// Find openai
	var openai *providerResponse
	var anthropic *providerResponse
	for i := range providers {
		if providers[i].ID == "openai" {
			openai = &providers[i]
		}
		if providers[i].ID == "anthropic" {
			anthropic = &providers[i]
		}
	}

	if openai == nil {
		t.Fatal("openai provider not found")
	}
	if !openai.HasKey {
		t.Error("expected openai has_key=true")
	}

	if anthropic == nil {
		t.Fatal("anthropic provider not found")
	}
	if anthropic.HasKey {
		t.Error("expected anthropic has_key=false")
	}
}

func TestListProviderModelsEmpty(t *testing.T) {
	api, r := setupTestAPI(t)
	setupProviderRoutes(api, r)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/openai/models", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var models []modelResponse
	if err := json.NewDecoder(w.Body).Decode(&models); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(models) != 0 {
		t.Errorf("expected empty models, got %d", len(models))
	}
}

func TestListProviderModels(t *testing.T) {
	api, r := setupTestAPI(t)
	setupProviderRoutes(api, r)

	// Seed data
	err := api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIBase: "https://api.openai.com/v1", APIFormat: "openai"},
	})
	if err != nil {
		t.Fatalf("seed provider: %v", err)
	}

	err = api.db.UpsertModels([]sqlite.ModelInfo{
		{ProviderID: "openai", ModelID: "gpt-4o", Name: "GPT-4o", Family: "GPT-4", ContextLimit: 128000, OutputLimit: 16384, CostInput: 2.5, CostOutput: 10.0, Reasoning: true, ToolCall: true, Attachment: true},
		{ProviderID: "openai", ModelID: "gpt-4o-mini", Name: "GPT-4o Mini", Family: "GPT-4", ContextLimit: 128000, OutputLimit: 16384, CostInput: 0.15, CostOutput: 0.6},
	})
	if err != nil {
		t.Fatalf("seed models: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/openai/models", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var models []modelResponse
	if err := json.NewDecoder(w.Body).Decode(&models); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}

	// Models are sorted by name
	if models[0].Name != "GPT-4o" {
		t.Errorf("first model name = %q, want GPT-4o", models[0].Name)
	}
	if models[0].ContextLimit != 128000 {
		t.Errorf("context_limit = %d, want 128000", models[0].ContextLimit)
	}
	if models[0].CostInput != 2.5 {
		t.Errorf("cost_input = %f, want 2.5", models[0].CostInput)
	}
	if !models[0].Reasoning {
		t.Error("expected reasoning=true")
	}
	if !models[0].ToolCall {
		t.Error("expected tool_call=true")
	}
}

func TestListProviderModelsFilterByProvider(t *testing.T) {
	api, r := setupTestAPI(t)
	setupProviderRoutes(api, r)

	// Seed two providers
	err := api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIFormat: "openai"},
		{ID: "anthropic", Name: "Anthropic", APIFormat: "anthropic"},
	})
	if err != nil {
		t.Fatalf("seed providers: %v", err)
	}

	err = api.db.UpsertModels([]sqlite.ModelInfo{
		{ProviderID: "openai", ModelID: "gpt-4o", Name: "GPT-4o"},
		{ProviderID: "anthropic", ModelID: "claude-3", Name: "Claude 3"},
	})
	if err != nil {
		t.Fatalf("seed models: %v", err)
	}

	// Query only openai models
	req := httptest.NewRequest(http.MethodGet, "/api/v1/providers/openai/models", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var models []modelResponse
	json.NewDecoder(w.Body).Decode(&models)
	if len(models) != 1 {
		t.Fatalf("expected 1 model for openai, got %d", len(models))
	}
	if models[0].ModelID != "gpt-4o" {
		t.Errorf("model_id = %q, want gpt-4o", models[0].ModelID)
	}
}
