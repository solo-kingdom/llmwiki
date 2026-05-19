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
	if resp.LastInstanceID != "" {
		t.Errorf("expected empty last_instance_id, got %q", resp.LastInstanceID)
	}
}

func TestUpdateSettingsAllowedKeys(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"temperature":   "0.7",
		"max_tokens":    "4096",
		"chunk_size":    "512",
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
		"instance_id": "inst_abc12345",
		"model":       "gpt-4o",
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
	if resp["last_instance_id"] != "inst_abc12345" {
		t.Errorf("last_instance_id = %q, want inst_abc12345", resp["last_instance_id"])
	}
	if resp["last_model"] != "gpt-4o" {
		t.Errorf("last_model = %q, want gpt-4o", resp["last_model"])
	}

	// Verify persisted
	instID, _ := api.db.GetConfig("last_instance_id")
	if instID != "inst_abc12345" {
		t.Errorf("persisted instance_id = %q, want inst_abc12345", instID)
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
		"instance_id": "inst_abc12345",
	})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/last-model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
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
