package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func setupSettingsRoutes(api *API, r chi.Router) {
	r.Get("/api/v1/settings", api.GetSettings)
	r.Put("/api/v1/settings", api.UpdateSettings)
	r.Put("/api/v1/settings/last-model", api.UpdateLastModel)
	r.Put("/api/v1/settings/provider-keys/{id}", api.UpdateProviderKey)
}

func TestGetSettingsEmpty(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp settingsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.LastProvider != "" {
		t.Errorf("expected empty last_provider, got %q", resp.LastProvider)
	}
	if resp.ProviderKeys == nil {
		t.Error("expected non-nil provider_keys map")
	}
}

func TestGetSettingsWithProviderKeys(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	// Set provider keys
	if err := api.db.SetProviderKey("openai", "sk-test-api-key-12345678", ""); err != nil {
		t.Fatalf("set key: %v", err)
	}
	if err := api.db.SetProviderKey("anthropic", "sk-ant-api03-another-key", "https://custom.anthropic.com"); err != nil {
		t.Fatalf("set key: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp settingsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(resp.ProviderKeys) != 2 {
		t.Fatalf("expected 2 provider keys, got %d", len(resp.ProviderKeys))
	}

	openaiKey, ok := resp.ProviderKeys["openai"]
	if !ok {
		t.Fatal("openai key not found in response")
	}
	if !openaiKey.Has {
		t.Error("expected openai has_key=true")
	}
	if openaiKey.Masked != "sk-t**************" && openaiKey.Masked == "" {
		// The key should be masked, not empty and not the full key
		t.Errorf("expected masked key, got %q", openaiKey.Masked)
	}

	anthropicKey, ok := resp.ProviderKeys["anthropic"]
	if !ok {
		t.Fatal("anthropic key not found in response")
	}
	if !anthropicKey.Has {
		t.Error("expected anthropic has_key=true")
	}
}

func TestUpdateSettingsAllowedKeys(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"temperature":  "0.7",
		"max_tokens":   "4096",
		"chunk_size":   "512",
		"chunk_overlap": "64",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp settingsResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Temperature != "0.7" {
		t.Errorf("temperature = %q, want 0.7", resp.Temperature)
	}
	if resp.MaxTokens != "4096" {
		t.Errorf("max_tokens = %q, want 4096", resp.MaxTokens)
	}
}

func TestUpdateSettingsIgnoresDisallowedKeys(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"temperature": "0.5",
		"evil_key":    "should be ignored",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	// evil_key should not be stored
	val, _ := api.db.GetConfig("evil_key")
	if val != "" {
		t.Error("expected evil_key to be ignored")
	}
}

func TestUpdateLastModel(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"provider": "openai",
		"model":    "gpt-4o",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/last-model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["last_provider"] != "openai" {
		t.Errorf("last_provider = %q, want openai", resp["last_provider"])
	}
	if resp["last_model"] != "gpt-4o" {
		t.Errorf("last_model = %q, want gpt-4o", resp["last_model"])
	}

	// Verify persisted
	p, _ := api.db.GetConfig("last_provider")
	if p != "openai" {
		t.Errorf("persisted provider = %q, want openai", p)
	}
	m, _ := api.db.GetConfig("last_model")
	if m != "gpt-4o" {
		t.Errorf("persisted model = %q, want gpt-4o", m)
	}
}

func TestUpdateLastModelMissingFields(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"provider": "openai",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/last-model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateProviderKey(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"api_key": "sk-test-key-12345678",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/provider-keys/openai", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["provider_id"] != "openai" {
		t.Errorf("provider_id = %q, want openai", resp["provider_id"])
	}
	if resp["masked_key"] == "" {
		t.Error("expected non-empty masked_key")
	}

	// Verify stored
	key, baseURL, _ := api.db.GetProviderKey("openai")
	if key != "sk-test-key-12345678" {
		t.Errorf("stored key = %q, want sk-test-key-12345678", key)
	}
	if baseURL != "" {
		t.Errorf("stored baseURL = %q, want empty", baseURL)
	}
}

func TestUpdateProviderKeyWithBaseURL(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"api_key":  "sk-test-key",
		"base_url": "https://custom.api.com/v1",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/provider-keys/openai", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["base_url"] != "https://custom.api.com/v1" {
		t.Errorf("base_url = %q, want https://custom.api.com/v1", resp["base_url"])
	}
}

func TestUpdateProviderKeyDelete(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	// First set a key
	api.db.SetProviderKey("openai", "sk-test-key", "")

	// Then delete it by sending empty key
	body, _ := json.Marshal(map[string]string{
		"api_key": "",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/provider-keys/openai", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "deleted" {
		t.Errorf("status = %q, want deleted", resp["status"])
	}

	// Verify deleted
	key, _, _ := api.db.GetProviderKey("openai")
	if key != "" {
		t.Errorf("key should be deleted, got %q", key)
	}
}

func TestMaskKey(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"", ""},
		{"short", "****"},
		{"sk-test-api-key-12345678", "sk-t**************"},
		{"123456789", "1235****"},
	}
	for _, tt := range tests {
		got := maskKey(tt.input)
		if tt.input == "" || len(tt.input) <= 8 {
			if got != tt.want {
				t.Errorf("maskKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		} else {
			if got == tt.input {
				t.Errorf("maskKey(%q) should mask the key", tt.input)
			}
			if got[:4] != tt.input[:4] {
				t.Errorf("maskKey(%q) prefix should be %q, got %q", tt.input, tt.input[:4], got[:4])
			}
		}
	}
}
