package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

// toolLoopTestServer creates an httptest.Server that simulates LLM responses.
// Each handler function corresponds to one Chat round-trip.
func toolLoopTestServer(handlers []func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	idx := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if idx < len(handlers) {
			handlers[idx](w, r)
			idx++
		} else {
			w.WriteHeader(500)
			fmt.Fprintf(w, "unexpected request %d", idx)
		}
	}))
}

func openaiToolCallResponse(callID, fnName, fnArgs string) map[string]interface{} {
	return map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"message": map[string]interface{}{
					"role": "assistant",
					"tool_calls": []interface{}{
						map[string]interface{}{
							"id":   callID,
							"type": "function",
							"function": map[string]interface{}{
								"name":      fnName,
								"arguments": fnArgs,
							},
						},
					},
				},
			},
		},
	}
}

func openaiTextResponse(text string) map[string]interface{} {
	return map[string]interface{}{
		"choices": []interface{}{
			map[string]interface{}{
				"message": map[string]interface{}{
					"role":    "assistant",
					"content": text,
				},
			},
		},
	}
}

func TestOrganizeModeRound0RetryOnNoToolCalls(t *testing.T) {
	callCount := 0
	server := toolLoopTestServer([]func(w http.ResponseWriter, r *http.Request){
		// Round 0: returns text only (no tool_calls) — model ignores tool_choice
		func(w http.ResponseWriter, r *http.Request) {
			callCount++
			writeJSON(w, openaiTextResponse("I'll help you organize"))
		},
		// Retry round 0: model calls structure tool
		func(w http.ResponseWriter, r *http.Request) {
			callCount++
			// Verify no tool_choice was sent in this retry (no forced)
			var body map[string]interface{}
			json.NewDecoder(r.Body).Decode(&body)
			if tc, ok := body["tool_choice"]; ok && tc == "required" {
				t.Errorf("retry should not use tool_choice=required, got: %v", tc)
			}
			writeJSON(w, openaiToolCallResponse("tc1", "structure", "{}"))
		},
		// Round 1: after tool result, model returns text
		func(w http.ResponseWriter, r *http.Request) {
			callCount++
			writeJSON(w, openaiTextResponse("Here is the diagnosis based on the structure."))
		},
	})
	defer server.Close()

	client := llm.NewClient(llm.Config{
		Provider: "openai",
		BaseURL:  server.URL,
		APIKey:   "test",
		Model:    "test-model",
	})

	executor := &stubExecutor{
		tools: []llm.ToolDefinition{
			{Name: "structure", Description: "Get wiki structure"},
		},
	}

	result, err := RunSessionChatToolLoop(
		context.Background(),
		client,
		executor,
		[]llm.Message{{Role: "user", Content: "organize my wiki"}},
		executor.tools,
		0.6,
		2048,
		llm.ToolLoopConfig{MaxRounds: 6, MaxToolCallsPerRound: 4},
		nil,
		"organize",
		nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "Here is the diagnosis based on the structure." {
		t.Fatalf("result = %q, want diagnosis text", result)
	}
	if callCount != 3 {
		t.Fatalf("expected 3 Chat calls, got %d", callCount)
	}
}

func TestOrganizeModePassesRequiredToolChoice(t *testing.T) {
	callCount := 0
	server := toolLoopTestServer([]func(w http.ResponseWriter, r *http.Request){
		// Round 0: should receive tool_choice=required
		func(w http.ResponseWriter, r *http.Request) {
			callCount++
			var body map[string]interface{}
			json.NewDecoder(r.Body).Decode(&body)
			tc, _ := body["tool_choice"]
			if tc != "required" {
				t.Errorf("round 0 should have tool_choice=required, got: %v", tc)
			}
			writeJSON(w, openaiToolCallResponse("tc1", "audit", "{}"))
		},
		// Round 1: after tool result
		func(w http.ResponseWriter, r *http.Request) {
			callCount++
			writeJSON(w, openaiTextResponse("Diagnosis complete"))
		},
	})
	defer server.Close()

	client := llm.NewClient(llm.Config{
		Provider: "openai",
		BaseURL:  server.URL,
		APIKey:   "test",
		Model:    "test-model",
	})

	executor := &stubExecutor{
		tools: []llm.ToolDefinition{
			{Name: "audit", Description: "Audit wiki"},
		},
	}

	_, err := RunSessionChatToolLoop(
		context.Background(),
		client,
		executor,
		[]llm.Message{{Role: "user", Content: "organize"}},
		executor.tools,
		0.6,
		2048,
		llm.ToolLoopConfig{MaxRounds: 6, MaxToolCallsPerRound: 4},
		nil,
		"organize",
		nil,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if callCount != 2 {
		t.Fatalf("expected 2 Chat calls, got %d", callCount)
	}
}

func TestIsBadRequestError(t *testing.T) {
	if !isBadRequestError(fmt.Errorf("bad request (HTTP 400): invalid")) {
		t.Error("should detect HTTP 400 error")
	}
	if !isBadRequestError(fmt.Errorf("bad request: something")) {
		t.Error("should detect 'bad request' error")
	}
	if isBadRequestError(fmt.Errorf("server error (HTTP 500)")) {
		t.Error("should not detect non-400 error")
	}
	if isBadRequestError(nil) {
		t.Error("nil should not be a bad request error")
	}
}

func TestMessageToolCallsSerialization(t *testing.T) {
	msg := llm.Message{
		Role:    "assistant",
		Content: "Let me check",
		ToolCalls: []llm.ToolCall{
			{ID: "call_1", Name: "structure", Arguments: `{"path":"wiki"}`},
			{ID: "call_2", Name: "audit", Arguments: `{}`},
		},
	}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(data)
	if !strings.Contains(s, `"tool_calls"`) {
		t.Errorf("JSON should contain tool_calls: %s", s)
	}
	if !strings.Contains(s, `"call_1"`) || !strings.Contains(s, `"structure"`) {
		t.Errorf("JSON should contain tool call details: %s", s)
	}

	// Verify round-trip
	var parsed llm.Message
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(parsed.ToolCalls) != 2 {
		t.Fatalf("expected 2 tool calls, got %d", len(parsed.ToolCalls))
	}
	if parsed.ToolCalls[0].ID != "call_1" || parsed.ToolCalls[0].Name != "structure" {
		t.Errorf("tool call 0 mismatch: %+v", parsed.ToolCalls[0])
	}
	if parsed.ToolCalls[1].ID != "call_2" || parsed.ToolCalls[1].Name != "audit" {
		t.Errorf("tool call 1 mismatch: %+v", parsed.ToolCalls[1])
	}
}

func TestMessageEmptyToolCallsOmitted(t *testing.T) {
	msg := llm.Message{
		Role:    "assistant",
		Content: "No tools needed",
	}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(data), "tool_calls") {
		t.Errorf("empty tool_calls should be omitted: %s", string(data))
	}
}

// stubExecutor is a minimal test double for ToolExecutor.
type stubExecutor struct {
	tools []llm.ToolDefinition
}

func (e *stubExecutor) Execute(ctx context.Context, name string, argsJSON string) (string, error) {
	return fmt.Sprintf("result of %s", name), nil
}

func (e *stubExecutor) ListTools(ctx context.Context) ([]llm.ToolDefinition, error) {
	return e.tools, nil
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	data, _ := json.Marshal(v)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}
