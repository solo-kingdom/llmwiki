package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateSettingsMCPServersJSONValid(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"mcp_servers_json": `{"version":1,"servers":{},"defaults":{"readonly_only":true,"fallback_mode":"local_only"}}`,
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
	if !strings.Contains(resp.MCPServersJSON, `"version": 1`) {
		t.Errorf("expected formatted JSON, got %s", resp.MCPServersJSON)
	}
}

func TestUpdateSettingsMCPServersJSONInvalid(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	body, _ := json.Marshal(map[string]string{
		"mcp_servers_json": `{"version":2}`,
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "version") {
		t.Fatalf("body=%s", w.Body.String())
	}
}

func TestGetSettingsIncludesMCPDefault(t *testing.T) {
	api, r := setupTestAPI(t)
	setupSettingsRoutes(api, r)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp settingsResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.MCPServersJSON == "" {
		t.Error("expected default mcp_servers_json in GET response")
	}
}
