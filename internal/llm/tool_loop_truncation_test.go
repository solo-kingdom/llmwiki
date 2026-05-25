package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestRunToolLoopTruncatesAssistantToolCallsToMatchToolMessages(t *testing.T) {
	var mu sync.Mutex
	var bodies []map[string]interface{}
	callCount := 0

	fiveToolCalls := `[
		{"id":"call_1","type":"function","function":{"name":"search","arguments":"{}"}},
		{"id":"call_2","type":"function","function":{"name":"search","arguments":"{}"}},
		{"id":"call_3","type":"function","function":{"name":"search","arguments":"{}"}},
		{"id":"call_4","type":"function","function":{"name":"search","arguments":"{}"}},
		{"id":"call_5","type":"function","function":{"name":"search","arguments":"{}"}}
	]`

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
			w.Write([]byte(`{"choices":[{"message":{"content":"","tool_calls":` + fiveToolCalls + `}}]}`))
			return
		}
		w.Write([]byte(`{"choices":[{"message":{"content":"done"}}]}`))
	}))
	defer server.Close()

	client := NewClient(Config{
		Provider: "openai",
		BaseURL:  server.URL,
		APIKey:   "sk-test",
		Model:    "gpt-4o",
	})

	tools := []ToolDefinition{
		{Name: "search", Description: "Search wiki", Parameters: map[string]interface{}{"type": "object"}},
	}
	msgs := []Message{{Role: "user", Content: "search"}}

	result, err := RunToolLoop(
		context.Background(),
		client,
		&stubToolExec{},
		msgs,
		tools,
		0.1,
		1024,
		ToolLoopConfig{MaxRounds: 4, MaxToolCallsPerRound: 3},
	)
	if err != nil {
		t.Fatalf("RunToolLoop: %v", err)
	}
	if result != "done" {
		t.Fatalf("result = %q, want done", result)
	}
	if callCount != 2 {
		t.Fatalf("expected 2 API calls, got %d", callCount)
	}
	if len(bodies) < 2 {
		t.Fatal("expected second request body")
	}

	rawMsgs, ok := bodies[1]["messages"].([]interface{})
	if !ok {
		t.Fatalf("messages = %#v", bodies[1]["messages"])
	}
	// user + assistant + 3 tool messages
	if len(rawMsgs) != 5 {
		t.Fatalf("round 1 message count = %d, want 5", len(rawMsgs))
	}

	assistant, ok := rawMsgs[1].(map[string]interface{})
	if !ok || assistant["role"] != "assistant" {
		t.Fatalf("expected assistant at index 1, got %#v", rawMsgs[1])
	}
	toolCalls, ok := assistant["tool_calls"].([]interface{})
	if !ok {
		t.Fatalf("tool_calls = %#v", assistant["tool_calls"])
	}
	if len(toolCalls) != 3 {
		t.Fatalf("assistant tool_calls len = %d, want 3", len(toolCalls))
	}

	toolMsgCount := 0
	for i := 2; i < len(rawMsgs); i++ {
		m, ok := rawMsgs[i].(map[string]interface{})
		if !ok {
			t.Fatalf("message %d = %#v", i, rawMsgs[i])
		}
		if m["role"] == "tool" {
			toolMsgCount++
			if m["tool_call_id"] == nil || m["tool_call_id"] == "" {
				t.Fatalf("tool message %d missing tool_call_id", i)
			}
		}
	}
	if toolMsgCount != 3 {
		t.Fatalf("tool message count = %d, want 3", toolMsgCount)
	}
}
