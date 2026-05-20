package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubRecorder struct {
	events []string
}

func (s *stubRecorder) RecordMCP(step, phase, message string, payload map[string]any) {
	s.events = append(s.events, phase)
}

func TestRouterStreamableHTTPListAndCall(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req JSONRPCRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		switch req.Method {
		case "tools/list":
			_ = json.NewEncoder(w).Encode(JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]any{
					"tools": []map[string]any{
						{"name": "search", "description": "search", "inputSchema": map[string]any{"type": "object"}},
					},
				},
			})
		case "tools/call":
			_ = json.NewEncoder(w).Encode(JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]any{
					"content": []map[string]any{{"type": "text", "text": "ok"}},
				},
			})
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer srv.Close()

	raw := `{
	  "version": 1,
	  "servers": [{
	    "id": "mock",
	    "name": "Mock",
	    "enabled": true,
	    "transport": "streamable-http",
	    "url": "` + srv.URL + `",
	    "scope": {"job": true},
	    "allowed_tools": ["search"]
	  }],
	  "defaults": {"readonly_only": true}
	}`
	reg, err := NewRegistry(raw)
	if err != nil {
		t.Fatal(err)
	}
	rec := &stubRecorder{}
	router := NewRouter(reg, rec)
	tools, _, err := router.ListToolsForJob(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 1 || tools[0].Name != "search" {
		t.Fatalf("tools: %+v", tools)
	}
	out, localOnly, err := router.CallTool(context.Background(), "search", map[string]interface{}{"q": "x"})
	if err != nil || localOnly || out != "ok" {
		t.Fatalf("call: out=%q localOnly=%v err=%v", out, localOnly, err)
	}
}

func TestRouterFailoverToLocalOnly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	raw := `{
	  "version": 1,
	  "servers": [{
	    "id": "bad",
	    "name": "Bad",
	    "enabled": true,
	    "transport": "streamable-http",
	    "url": "` + srv.URL + `",
	    "scope": {"job": true},
	    "allowed_tools": ["search"]
	  }]
	}`
	reg, _ := NewRegistry(raw)
	rec := &stubRecorder{}
	router := NewRouter(reg, rec)
	_, localOnly, _ := router.CallTool(context.Background(), "search", nil)
	if !localOnly {
		t.Fatal("expected local_only degradation")
	}
	found := false
	for _, e := range rec.events {
		if strings.Contains(e, "mcp_fallback_local_only") || strings.Contains(e, "mcp_degraded") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected degradation events, got %v", rec.events)
	}
}

func TestRouterWriteToolDenied(t *testing.T) {
	reg, _ := NewRegistry(`{"version":1,"servers":[{"id":"s","name":"S","enabled":true,"transport":"streamable-http","url":"http://127.0.0.1:1","scope":{"job":true},"allowed_tools":["search"]}]}`)
	router := NewRouter(reg, nil)
	_, localOnly, err := router.CallTool(context.Background(), "create", nil)
	if err == nil && !localOnly {
		t.Fatal("expected create to be denied")
	}
}
