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

func setupProviderCheckRoutes(api *API, r chi.Router) {
	r.Post("/api/v1/provider-instances/check", api.CheckAllProviderInstances)
	r.Post("/api/v1/provider-instances/{id}/check", api.CheckProviderInstance)
}

func TestCheckProviderInstanceMissingKey(t *testing.T) {
	api, r := setupTestAPI(t)
	setupProviderCheckRoutes(api, r)

	err := api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIBase: "https://api.openai.com/v1", APIFormat: "openai"},
	})
	if err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	inst := &sqlite.ProviderInstance{Name: "Test", CatalogID: "openai", BaseURL: "https://api.openai.com/v1"}
	if err := api.db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("create instance: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/provider-instances/"+inst.ID+"/check", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var resp providerCheckResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != "error" {
		t.Errorf("status = %q, want error", resp.Status)
	}
	if resp.Message != "未设置 API Key" {
		t.Errorf("message = %q", resp.Message)
	}
}

func TestCheckProviderInstanceReachable(t *testing.T) {
	api, r := setupTestAPI(t)
	setupProviderCheckRoutes(api, r)

	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"data":[]}`))
	}))
	defer mock.Close()

	err := api.db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIBase: mock.URL, APIFormat: "openai"},
	})
	if err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	inst := &sqlite.ProviderInstance{
		Name: "Test", CatalogID: "openai", APIKey: "sk-test", BaseURL: mock.URL,
	}
	if err := api.db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("create instance: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/provider-instances/"+inst.ID+"/check", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var resp providerCheckResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != "ok" {
		t.Errorf("status = %q, want ok", resp.Status)
	}
	if !resp.Details.Reachable {
		t.Error("expected reachable=true")
	}
}

func setupMCPCheckRoutes(api *API, r chi.Router) {
	r.Post("/api/v1/settings/mcp/check", api.CheckMCPStatus)
}

func TestCheckMCPStatusDisabledServer(t *testing.T) {
	api, r := setupTestAPI(t)
	setupMCPCheckRoutes(api, r)

	body := bytes.NewReader([]byte(`{
		"mcp_servers_json": "{\"version\":1,\"servers\":[{\"id\":\"s1\",\"name\":\"Local\",\"enabled\":false,\"transport\":\"streamable-http\",\"url\":\"http://127.0.0.1:9\",\"timeout_ms\":1000,\"retry\":{\"max\":0,\"backoff_ms\":0},\"scope\":{\"job\":true,\"chat\":false}}],\"defaults\":{\"readonly_only\":true,\"fallback_mode\":\"local_only\"}}"
	}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/mcp/check", body)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", w.Code, w.Body.String())
	}
	var resp mcpCheckResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Servers) != 1 {
		t.Fatalf("servers = %d, want 1", len(resp.Servers))
	}
	if resp.Servers[0].Status != "disabled" {
		t.Errorf("status = %q, want disabled", resp.Servers[0].Status)
	}
}

func TestCheckMCPStatusInvalidJSON(t *testing.T) {
	api, r := setupTestAPI(t)
	setupMCPCheckRoutes(api, r)

	body := bytes.NewReader([]byte(`{"mcp_servers_json":"not-json"}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/mcp/check", body)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
