package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --- Task 2.1: ToolPolicy structure tests ---

func TestDefaultToolPolicy_ReadOnly(t *testing.T) {
	policy := DefaultToolPolicy(false)

	// Readonly tools are allowed
	for _, name := range []string{"guide", "search", "read", "references", "lint", "ping"} {
		if !policy.IsAllowed(name) {
			t.Errorf("expected readonly tool %q to be allowed", name)
		}
	}

	// Write tools are denied
	for _, name := range []string{"write", "delete"} {
		if policy.IsAllowed(name) {
			t.Errorf("expected write tool %q to be denied when AllowWriteTools=false", name)
		}
	}
}

func TestDefaultToolPolicy_WriteEnabled(t *testing.T) {
	policy := DefaultToolPolicy(true)

	// All tools are allowed
	for _, name := range []string{"guide", "search", "read", "references", "lint", "ping", "write", "delete"} {
		if !policy.IsAllowed(name) {
			t.Errorf("expected tool %q to be allowed when AllowWriteTools=true", name)
		}
	}
}

func TestToolPolicy_UnknownToolsAllowed(t *testing.T) {
	policy := DefaultToolPolicy(false)

	// Unknown tools should be allowed (test tools, future tools)
	if !policy.IsAllowed("custom_tool") {
		t.Error("expected unknown tool to be allowed by default")
	}
	if !policy.IsAllowed("echo") {
		t.Error("expected unknown tool 'echo' to be allowed by default")
	}
}

func TestToolPolicy_FilterTools(t *testing.T) {
	policy := DefaultToolPolicy(false)

	tools := []Tool{
		{Name: "guide"},
		{Name: "search"},
		{Name: "read"},
		{Name: "write"},
		{Name: "delete"},
		{Name: "ping"},
	}

	filtered := policy.FilterTools(tools)
	names := make(map[string]bool, len(filtered))
	for _, t := range filtered {
		names[t.Name] = true
	}

	// Readonly tools present
	for _, n := range []string{"guide", "search", "read", "ping"} {
		if !names[n] {
			t.Errorf("expected readonly tool %q in filtered list", n)
		}
	}
	// Write tools absent
	for _, n := range []string{"write", "delete"} {
		if names[n] {
			t.Errorf("expected write tool %q to be filtered out", n)
		}
	}
}

// --- Task 2.2: Initialize _meta tests ---

func TestInitialize_MetaFields(t *testing.T) {
	s := NewServer("test", "")
	s.SetToolPolicy(DefaultToolPolicy(false))

	req := &JSONRPCRequest{JSONRPC: "2.0", ID: 1, Method: "initialize"}
	resp := s.handleRequest(req)

	result := resp.Result.(map[string]interface{})
	meta := result["_meta"].(map[string]interface{})

	if meta["transport"] != "http-post-jsonrpc" {
		t.Errorf("expected transport 'http-post-jsonrpc', got %v", meta["transport"])
	}
	if meta["auth"] != "required-when-remote" {
		t.Errorf("expected auth 'required-when-remote', got %v", meta["auth"])
	}
	if meta["defaultToolPolicy"] != "readonly" {
		t.Errorf("expected defaultToolPolicy 'readonly', got %v", meta["defaultToolPolicy"])
	}
}

func TestInitialize_MetaReadWritePolicy(t *testing.T) {
	s := NewServer("test", "")
	s.SetToolPolicy(DefaultToolPolicy(true))

	req := &JSONRPCRequest{JSONRPC: "2.0", ID: 1, Method: "initialize"}
	resp := s.handleRequest(req)

	result := resp.Result.(map[string]interface{})
	meta := result["_meta"].(map[string]interface{})

	if meta["defaultToolPolicy"] != "readwrite" {
		t.Errorf("expected defaultToolPolicy 'readwrite', got %v", meta["defaultToolPolicy"])
	}
}

// --- Task 2.3: Tools/list respects policy ---

func TestToolsList_ReadOnlyPolicy(t *testing.T) {
	s := NewServer("test", "")
	s.SetToolPolicy(DefaultToolPolicy(false))
	s.RegisterTool(Tool{Name: "guide"}, func(args map[string]interface{}) (string, error) { return "", nil })
	s.RegisterTool(Tool{Name: "search"}, func(args map[string]interface{}) (string, error) { return "", nil })
	s.RegisterTool(Tool{Name: "write"}, func(args map[string]interface{}) (string, error) { return "", nil })
	s.RegisterTool(Tool{Name: "delete"}, func(args map[string]interface{}) (string, error) { return "", nil })

	req := &JSONRPCRequest{JSONRPC: "2.0", ID: 2, Method: "tools/list"}
	resp := s.handleRequest(req)

	result := resp.Result.(map[string]interface{})
	toolsRaw := result["tools"]
	toolsJSON, _ := json.Marshal(toolsRaw)
	var tools []Tool
	json.Unmarshal(toolsJSON, &tools)

	names := make(map[string]bool)
	for _, t := range tools {
		names[t.Name] = true
	}

	if !names["guide"] || !names["search"] {
		t.Error("expected readonly tools in list")
	}
	if names["write"] {
		t.Error("expected write tool to be filtered out in readonly policy")
	}
	if names["delete"] {
		t.Error("expected delete tool to be filtered out in readonly policy")
	}
}

func TestToolsList_WriteEnabledPolicy(t *testing.T) {
	s := NewServer("test", "")
	s.SetToolPolicy(DefaultToolPolicy(true))
	s.RegisterTool(Tool{Name: "guide"}, func(args map[string]interface{}) (string, error) { return "", nil })
	s.RegisterTool(Tool{Name: "write"}, func(args map[string]interface{}) (string, error) { return "", nil })
	s.RegisterTool(Tool{Name: "delete"}, func(args map[string]interface{}) (string, error) { return "", nil })

	req := &JSONRPCRequest{JSONRPC: "2.0", ID: 2, Method: "tools/list"}
	resp := s.handleRequest(req)

	result := resp.Result.(map[string]interface{})
	toolsRaw := result["tools"]
	toolsJSON, _ := json.Marshal(toolsRaw)
	var tools []Tool
	json.Unmarshal(toolsJSON, &tools)

	names := make(map[string]bool)
	for _, t := range tools {
		names[t.Name] = true
	}

	if !names["guide"] || !names["write"] || !names["delete"] {
		t.Error("expected all tools in list when write enabled")
	}
}

// --- Task 2.4: Tools/call policy enforcement ---

func TestToolsCall_PolicyDenied(t *testing.T) {
	s := NewServer("test", "")
	s.SetToolPolicy(DefaultToolPolicy(false))
	s.RegisterTool(Tool{Name: "write"}, func(args map[string]interface{}) (string, error) {
		return "should not reach here", nil
	})

	params, _ := json.Marshal(ToolCallParams{Name: "write"})
	req := &JSONRPCRequest{JSONRPC: "2.0", ID: 1, Method: "tools/call", Params: params}
	resp := s.handleRequest(req)

	if resp.Error == nil {
		t.Fatal("expected error for policy-denied tool")
	}
	if resp.Error.Code != -32000 {
		t.Errorf("expected error code -32000, got %d", resp.Error.Code)
	}
}

func TestToolsCall_WriteAllowed(t *testing.T) {
	s := NewServer("test", "")
	s.SetToolPolicy(DefaultToolPolicy(true))
	s.RegisterTool(Tool{Name: "write"}, func(args map[string]interface{}) (string, error) {
		return "written", nil
	})

	params, _ := json.Marshal(ToolCallParams{Name: "write"})
	req := &JSONRPCRequest{JSONRPC: "2.0", ID: 1, Method: "tools/call", Params: params}
	resp := s.handleRequest(req)

	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error.Message)
	}
}

// --- Task 2.6: JSON-RPC request validation ---

func TestHTTPHandler_InvalidJSON(t *testing.T) {
	s := NewServer("test", "")
	handler := NewHTTPHandler(s)

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte("not json")))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}

	var resp JSONRPCResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Error == nil || resp.Error.Code != -32700 {
		t.Errorf("expected parse error code -32700, got %v", resp.Error)
	}
}

func TestHTTPHandler_NonPostRejected(t *testing.T) {
	s := NewServer("test", "")
	handler := NewHTTPHandler(s)

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		req := httptest.NewRequest(method, "/mcp", nil)
		w := httptest.NewRecorder()
		handler(w, req)

		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("expected 405 for %s, got %d", method, w.Code)
		}
	}
}

func TestToolsCall_MissingArguments(t *testing.T) {
	s := NewServer("test", "")
	s.RegisterTool(Tool{Name: "ping"}, func(args map[string]interface{}) (string, error) {
		return "pong", nil
	})

	// Call without arguments field
	params, _ := json.Marshal(map[string]interface{}{"name": "ping"})
	req := &JSONRPCRequest{JSONRPC: "2.0", ID: 1, Method: "tools/call", Params: params}
	resp := s.handleRequest(req)

	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error.Message)
	}
}

func TestToolsCall_DisabledWriteToolViaHTTP(t *testing.T) {
	s := NewServer("test", "")
	s.SetToolPolicy(DefaultToolPolicy(false))
	s.RegisterTool(Tool{Name: "write"}, func(args map[string]interface{}) (string, error) {
		return "should not run", nil
	})

	handler := NewHTTPHandler(s)

	params, _ := json.Marshal(map[string]interface{}{"name": "write"})
	body, _ := json.Marshal(JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      float64(1),
		Method:  "tools/call",
		Params:  params,
	})

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (JSON-RPC error in body), got %d", w.Code)
	}

	var resp JSONRPCResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Error == nil {
		t.Fatal("expected JSON-RPC error for disabled write tool")
	}
	if resp.Error.Code != -32000 {
		t.Errorf("expected error code -32000, got %d", resp.Error.Code)
	}
}
