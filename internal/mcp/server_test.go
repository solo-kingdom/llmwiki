package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleInitialize(t *testing.T) {
	s := NewServer("test-server", "test instructions")

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "initialize",
	}

	resp := s.handleRequest(req)
	if resp == nil {
		t.Fatal("handleRequest() returned nil")
	}
	if resp.JSONRPC != "2.0" {
		t.Errorf("expected jsonrpc 2.0, got %q", resp.JSONRPC)
	}
	if resp.Error != nil {
		t.Errorf("unexpected error: %v", resp.Error.Message)
	}

	result, ok := resp.Result.(map[string]interface{})
	if !ok {
		t.Fatal("result is not a map")
	}
	if result["protocolVersion"] != "2025-03-26" {
		t.Errorf("unexpected protocol version: %v", result["protocolVersion"])
	}

	info, ok := result["serverInfo"].(map[string]interface{})
	if !ok {
		t.Fatal("serverInfo is not a map")
	}
	if info["name"] != "test-server" {
		t.Errorf("expected name 'test-server', got %v", info["name"])
	}
	if result["instructions"] != "test instructions" {
		t.Errorf("expected instructions, got %v", result["instructions"])
	}
}

func TestHandleToolsList(t *testing.T) {
	s := NewServer("test", "")

	s.RegisterTool(Tool{
		Name:        "search",
		Description: "Search documents",
		InputSchema: map[string]interface{}{"type": "object"},
	}, func(args map[string]interface{}) (string, error) {
		return "", nil
	})

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      2,
		Method:  "tools/list",
	}

	resp := s.handleRequest(req)
	if resp == nil {
		t.Fatal("handleRequest() returned nil")
	}
	if resp.Error != nil {
		t.Errorf("unexpected error: %v", resp.Error.Message)
	}

	result, ok := resp.Result.(map[string]interface{})
	if !ok {
		t.Fatal("result is not a map")
	}
	tools, ok := result["tools"].([]Tool)
	if !ok {
		t.Fatal("tools is not a slice")
	}
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
	if tools[0].Name != "search" {
		t.Errorf("expected tool name 'search', got %q", tools[0].Name)
	}
}

func TestHandleToolsCall(t *testing.T) {
	s := NewServer("test", "")

	s.RegisterTool(Tool{
		Name:        "echo",
		Description: "Echo back input",
		InputSchema: map[string]interface{}{"type": "object"},
	}, func(args map[string]interface{}) (string, error) {
		return "echo result", nil
	})

	params, _ := json.Marshal(ToolCallParams{
		Name:      "echo",
		Arguments: map[string]interface{}{"text": "hello"},
	})

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      3,
		Method:  "tools/call",
		Params:  params,
	}

	resp := s.handleRequest(req)
	if resp == nil {
		t.Fatal("handleRequest() returned nil")
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %v", resp.Error.Message)
	}

	result, ok := resp.Result.(map[string]interface{})
	if !ok {
		t.Fatal("result is not a map")
	}
	content, ok := result["content"].([]map[string]interface{})
	if !ok {
		t.Fatal("content is not a slice")
	}
	if len(content) == 0 {
		t.Fatal("expected content in response")
	}
	if content[0]["text"] != "echo result" {
		t.Errorf("expected 'echo result', got %v", content[0]["text"])
	}
}

func TestHandleToolsCallNotFound(t *testing.T) {
	s := NewServer("test", "")

	params, _ := json.Marshal(ToolCallParams{
		Name: "nonexistent",
	})

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      4,
		Method:  "tools/call",
		Params:  params,
	}

	resp := s.handleRequest(req)
	if resp == nil {
		t.Fatal("handleRequest() returned nil")
	}
	if resp.Error == nil {
		t.Fatal("expected error for nonexistent tool")
	}
	if resp.Error.Code != -32000 {
		t.Errorf("expected error code -32000, got %d", resp.Error.Code)
	}
}

func TestHandleToolsCallInvalidParams(t *testing.T) {
	s := NewServer("test", "")

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      5,
		Method:  "tools/call",
		Params:  json.RawMessage(`invalid json`),
	}

	resp := s.handleRequest(req)
	if resp == nil {
		t.Fatal("handleRequest() returned nil")
	}
	if resp.Error == nil {
		t.Fatal("expected error for invalid params")
	}
	if resp.Error.Code != -32602 {
		t.Errorf("expected error code -32602, got %d", resp.Error.Code)
	}
}

func TestHandleUnknownMethod(t *testing.T) {
	s := NewServer("test", "")

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      6,
		Method:  "unknown/method",
	}

	resp := s.handleRequest(req)
	if resp == nil {
		t.Fatal("handleRequest() returned nil")
	}
	if resp.Error == nil {
		t.Fatal("expected error for unknown method")
	}
	if resp.Error.Code != -32601 {
		t.Errorf("expected error code -32601, got %d", resp.Error.Code)
	}
}

func TestHandleNotificationNoResponse(t *testing.T) {
	s := NewServer("test", "")

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  "notifications/initialized",
	}

	resp := s.handleRequest(req)
	if resp != nil {
		t.Error("expected nil response for notification")
	}
}

func TestHandleToolsCallError(t *testing.T) {
	s := NewServer("test", "")

	s.RegisterTool(Tool{
		Name:        "fail",
		Description: "Always fails",
		InputSchema: map[string]interface{}{"type": "object"},
	}, func(args map[string]interface{}) (string, error) {
		return "", &testError{msg: "something went wrong"}
	})

	params, _ := json.Marshal(ToolCallParams{
		Name: "fail",
	})

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      7,
		Method:  "tools/call",
		Params:  params,
	}

	resp := s.handleRequest(req)
	if resp == nil {
		t.Fatal("handleRequest() returned nil")
	}

	result, ok := resp.Result.(map[string]interface{})
	if !ok {
		t.Fatal("result is not a map")
	}
	isError, ok := result["isError"].(bool)
	if !ok || !isError {
		t.Error("expected isError to be true")
	}
}

func TestNewHTTPHandlerPost(t *testing.T) {
	s := NewServer("test", "")
	s.RegisterTool(Tool{
		Name:        "greet",
		Description: "Say hello",
		InputSchema: map[string]interface{}{"type": "object"},
	}, func(args map[string]interface{}) (string, error) {
		return "hello", nil
	})

	handler := NewHTTPHandler(s)

	body, _ := json.Marshal(JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      10,
		Method:  "initialize",
	})

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp JSONRPCResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.JSONRPC != "2.0" {
		t.Errorf("expected jsonrpc 2.0, got %q", resp.JSONRPC)
	}
}

func TestNewHTTPHandlerGetRejected(t *testing.T) {
	s := NewServer("test", "")
	handler := NewHTTPHandler(s)

	req := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", w.Code)
	}
}

func TestNewHTTPHandlerInvalidJSON(t *testing.T) {
	s := NewServer("test", "")
	handler := NewHTTPHandler(s)

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestNewHTTPHandlerNotification(t *testing.T) {
	s := NewServer("test", "")
	handler := NewHTTPHandler(s)

	body, _ := json.Marshal(JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  "notifications/initialized",
	})

	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected status 204 for notification, got %d", w.Code)
	}
}

type testError struct {
	msg string
}

func (e *testError) Error() string {
	return e.msg
}
