package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListACPAgentsEmpty(t *testing.T) {
	api, r := setupTestAPI(t)
	r.Get("/api/v1/acp-agents", api.ListACPAgents)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/acp-agents", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"agents":[]`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestListACPAgentsRedactsEnvironmentValues(t *testing.T) {
	api, r := setupTestAPI(t)
	r.Get("/api/v1/acp-agents", api.ListACPAgents)
	t.Setenv("ACP_PRESENT_TEST_KEY", "sk-secret-value-that-must-not-leak")
	raw := `{"version":1,"agents":{"x":{"id":"x","name":"X","enabled":true,"command":"echo","env_passthrough":["ACP_PRESENT_TEST_KEY","ACP_MISSING_TEST_KEY"]}},"defaults":{}}`
	if err := api.db.SetConfig("acp_agents_json", raw); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/acp-agents", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, "sk-secret-value-that-must-not-leak") {
		t.Fatalf("environment value leaked: %s", body)
	}
	var resp struct {
		Agents []struct {
			EnvPassthrough []struct {
				Name    string `json:"name"`
				Present bool   `json:"present"`
			} `json:"env_passthrough"`
		} `json:"agents"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Agents) != 1 || len(resp.Agents[0].EnvPassthrough) != 2 {
		t.Fatalf("unexpected response: %s", body)
	}
	if !resp.Agents[0].EnvPassthrough[0].Present || resp.Agents[0].EnvPassthrough[1].Present {
		t.Fatalf("env presence mismatch: %+v", resp.Agents[0].EnvPassthrough)
	}
}

func TestListACPAgentsInvalidConfig(t *testing.T) {
	api, r := setupTestAPI(t)
	r.Get("/api/v1/acp-agents", api.ListACPAgents)
	_ = api.db.SetConfig("acp_agents_json", "{")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/acp-agents", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "config_error") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestCheckACPAgents(t *testing.T) {
	api, r := setupTestAPI(t)
	r.Post("/api/v1/acp-agents/check", api.CheckACPAgents)
	raw := `{"version":1,"agents":{"x":{"id":"x","name":"X","enabled":true,"command":"definitely-missing-acp-cli"}},"defaults":{}}`
	body, _ := json.Marshal(map[string]string{"acp_agents_json": raw})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/acp-agents/check", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"code":"cli_not_found"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
