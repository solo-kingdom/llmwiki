package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestRunToolLoopRoundTripsReasoningContent(t *testing.T) {
	var mu sync.Mutex
	var bodies []map[string]interface{}
	callCount := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		callCount++

		data, _ := io.ReadAll(r.Body)
		var body map[string]interface{}
		_ = json.Unmarshal(data, &body)
		bodies = append(bodies, body)

		w.Header().Set("Content-Type", "application/json")
		if callCount == 1 {
			w.Write([]byte(`{
				"choices":[{
					"message":{
						"content":"",
						"reasoning_content":"thinking step one",
						"tool_calls":[{
							"id":"call_1",
							"type":"function",
							"function":{"name":"search","arguments":"{\"query\":\"wiki\"}"}
						}]
					}
				}]
			}`))
			return
		}
		w.Write([]byte(`{"choices":[{"message":{"content":"done"}}]}`))
	}))
	defer server.Close()

	client := NewClient(Config{
		Provider: "openai",
		BaseURL:  server.URL,
		APIKey:   "sk-test",
		Model:    "deepseek-chat",
	})

	tools := []ToolDefinition{
		{Name: "search", Description: "Search wiki", Parameters: map[string]interface{}{"type": "object"}},
	}
	msgs := []Message{{Role: "user", Content: "search wiki"}}

	result, err := RunToolLoop(
		context.Background(),
		client,
		&stubToolExec{},
		msgs,
		tools,
		0.1,
		1024,
		ToolLoopConfig{MaxRounds: 4, MaxToolCallsPerRound: 2},
	)
	if err != nil {
		t.Fatalf("RunToolLoop: %v", err)
	}
	if result != "done" {
		t.Fatalf("result = %q, want done", result)
	}
	if callCount != 2 {
		t.Fatalf("expected 2 calls, got %d", callCount)
	}
	if len(bodies) < 2 {
		t.Fatal("expected second request body")
	}

	rawMsgs, ok := bodies[1]["messages"].([]interface{})
	if !ok || len(rawMsgs) < 2 {
		t.Fatalf("second request messages = %#v", bodies[1]["messages"])
	}
	assistant, ok := rawMsgs[1].(map[string]interface{})
	if !ok || assistant["role"] != "assistant" {
		t.Fatalf("expected assistant message at index 1, got %#v", rawMsgs[1])
	}
	if assistant["reasoning_content"] != "thinking step one" {
		t.Fatalf("reasoning_content = %#v, want thinking step one", assistant["reasoning_content"])
	}
	toolCalls, ok := assistant["tool_calls"].([]interface{})
	if !ok || len(toolCalls) == 0 {
		t.Fatalf("expected tool_calls on assistant message, got %#v", assistant["tool_calls"])
	}
}

func TestParseChatResponseReasoningContent(t *testing.T) {
	resp := `{"choices":[{"message":{"content":"hi","reasoning_content":"chain","tool_calls":[]}}]}`
	result, err := parseChatResponse([]byte(resp), "openai")
	if err != nil {
		t.Fatalf("parseChatResponse: %v", err)
	}
	if result.ReasoningContent != "chain" {
		t.Fatalf("ReasoningContent = %q, want chain", result.ReasoningContent)
	}
	if !strings.Contains(result.Content, "hi") {
		t.Fatalf("Content = %q", result.Content)
	}
}
