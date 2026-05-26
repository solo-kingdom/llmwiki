package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnthropicBuildChatBodyWithTools(t *testing.T) {
	c := NewClient(Config{
		Provider: "anthropic",
		BaseURL:  "https://api.anthropic.com",
		APIKey:   "sk-test",
		Model:    "claude-3-opus",
	})
	msgs := []Message{
		{Role: "system", Content: "You are a helper."},
		{Role: "user", Content: "hello"},
	}
	tools := []ToolDefinition{
		{Name: "search", Description: "Search wiki", Parameters: map[string]interface{}{"type": "object"}},
	}
	body, err := c.buildChatBody(msgs, tools, 0.7, 100, false, "")
	if err != nil {
		t.Fatalf("buildChatBody: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("parse json: %v", err)
	}

	// System should be at top level, not in messages
	sys, ok := parsed["system"].(string)
	if !ok || sys == "" {
		t.Fatal("system should be at top level for Anthropic")
	}
	if !strings.Contains(sys, "You are a helper") {
		t.Fatalf("system = %q, want helper text", sys)
	}

	// Messages should not contain system role
	msgsArr, ok := parsed["messages"].([]interface{})
	if !ok {
		t.Fatal("messages should be an array")
	}
	for _, m := range msgsArr {
		role := m.(map[string]interface{})["role"].(string)
		if role == "system" {
			t.Fatal("system message should be extracted to top-level for Anthropic")
		}
	}

	// Tools should be present
	toolsArr, ok := parsed["tools"].([]interface{})
	if !ok || len(toolsArr) != 1 {
		t.Fatalf("expected 1 tool, got %v", parsed["tools"])
	}
	tool := toolsArr[0].(map[string]interface{})
	if tool["name"] != "search" {
		t.Fatalf("tool name = %v, want search", tool["name"])
	}
	if _, hasSchema := tool["input_schema"]; !hasSchema {
		t.Fatal("anthropic tool should have input_schema, not parameters")
	}
}

func TestAnthropicBuildChatBodyToolChoiceRequired(t *testing.T) {
	c := NewClient(Config{
		Provider: "anthropic",
		BaseURL:  "https://api.anthropic.com",
		APIKey:   "sk-test",
		Model:    "claude-3-opus",
	})
	msgs := []Message{{Role: "user", Content: "hello"}}
	tools := []ToolDefinition{
		{Name: "search", Description: "Search wiki", Parameters: map[string]interface{}{"type": "object"}},
	}
	body, err := c.buildChatBody(msgs, tools, 0.7, 100, false, "required")
	if err != nil {
		t.Fatalf("buildChatBody: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("parse json: %v", err)
	}
	tc, ok := parsed["tool_choice"].(map[string]interface{})
	if !ok {
		t.Fatal("tool_choice should be an object for Anthropic")
	}
	if tc["type"] != "any" {
		t.Fatalf("tool_choice.type = %v, want 'any'", tc["type"])
	}
}

func TestAnthropicParseChatResponseToolUse(t *testing.T) {
	resp := `{
		"content": [
			{"type": "text", "text": "Let me check."},
			{"type": "tool_use", "id": "tu_1", "name": "search", "input": {"query": "test"}}
		]
	}`
	result, err := parseChatResponse([]byte(resp), "anthropic")
	if err != nil {
		t.Fatalf("parseChatResponse: %v", err)
	}
	if result.Content != "Let me check." {
		t.Fatalf("content = %q, want 'Let me check.'", result.Content)
	}
	if len(result.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(result.ToolCalls))
	}
	tc := result.ToolCalls[0]
	if tc.ID != "tu_1" {
		t.Fatalf("tool call ID = %q, want 'tu_1'", tc.ID)
	}
	if tc.Name != "search" {
		t.Fatalf("tool call name = %q, want 'search'", tc.Name)
	}
	if !strings.Contains(tc.Arguments, "query") {
		t.Fatalf("tool call arguments = %q, should contain query", tc.Arguments)
	}
}

func TestAnthropicParseChatResponseTextOnly(t *testing.T) {
	resp := `{
		"content": [
			{"type": "text", "text": "Hello there!"}
		]
	}`
	result, err := parseChatResponse([]byte(resp), "anthropic")
	if err != nil {
		t.Fatalf("parseChatResponse: %v", err)
	}
	if result.Content != "Hello there!" {
		t.Fatalf("content = %q, want 'Hello there!'", result.Content)
	}
	if len(result.ToolCalls) != 0 {
		t.Fatalf("expected 0 tool calls, got %d", len(result.ToolCalls))
	}
}

func TestAnthropicMultiTurnToolMessages(t *testing.T) {
	msgs := []Message{
		{Role: "user", Content: "search for X"},
		{Role: "assistant", Content: "searching", ToolCalls: []ToolCall{
			{ID: "tc1", Name: "search", Arguments: `{"query":"X"}`},
		}},
		{Role: "tool", Content: "found X", ToolCallID: "tc1", Name: "search"},
		{Role: "user", Content: "now what?"},
	}
	result := convertToAnthropicMessages(msgs)

	// Should have: user, assistant, user (tool_result), user
	if len(result) != 4 {
		t.Fatalf("expected 4 messages, got %d", len(result))
	}
	if result[0].Role != "user" {
		t.Fatalf("msg 0 role = %q, want user", result[0].Role)
	}
	if result[1].Role != "assistant" {
		t.Fatalf("msg 1 role = %q, want assistant", result[1].Role)
	}
	// Assistant message should have content as JSON array with tool_use
	var contentArr []map[string]interface{}
	if err := json.Unmarshal([]byte(result[1].Content), &contentArr); err != nil {
		t.Fatalf("assistant content should be JSON array: %v", err)
	}
	hasToolUse := false
	for _, block := range contentArr {
		if block["type"] == "tool_use" {
			hasToolUse = true
			if block["id"] != "tc1" || block["name"] != "search" {
				t.Fatalf("tool_use block: %+v", block)
			}
		}
	}
	if !hasToolUse {
		t.Fatal("assistant content should contain a tool_use block")
	}

	// Tool result should be user message with tool_result content
	if result[2].Role != "user" {
		t.Fatalf("msg 2 role = %q, want user (tool_result)", result[2].Role)
	}
	var toolResults []map[string]interface{}
	if err := json.Unmarshal([]byte(result[2].Content), &toolResults); err != nil {
		t.Fatalf("tool result content should be JSON array: %v", err)
	}
	if len(toolResults) != 1 || toolResults[0]["type"] != "tool_result" {
		t.Fatalf("expected tool_result block, got: %+v", toolResults)
	}
	if toolResults[0]["tool_use_id"] != "tc1" {
		t.Fatalf("tool_use_id = %v, want tc1", toolResults[0]["tool_use_id"])
	}

	if result[3].Role != "user" || result[3].Content != "now what?" {
		t.Fatalf("msg 3 = %+v, want user 'now what?'", result[3])
	}
}

func TestOllamaBuildChatBodyWithTools(t *testing.T) {
	c := NewClient(Config{
		Provider: "ollama",
		BaseURL:  "http://localhost:11434",
		APIKey:   "",
		Model:    "llama3",
	})
	msgs := []Message{{Role: "user", Content: "hello"}}
	tools := []ToolDefinition{
		{Name: "search", Description: "Search wiki", Parameters: map[string]interface{}{"type": "object"}},
	}
	body, err := c.buildChatBody(msgs, tools, 0.7, 100, false, "")
	if err != nil {
		t.Fatalf("buildChatBody: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("parse json: %v", err)
	}
	toolsArr, ok := parsed["tools"].([]interface{})
	if !ok || len(toolsArr) != 1 {
		t.Fatalf("expected 1 tool, got %v", parsed["tools"])
	}
}

func TestOllamaParseChatResponseWithToolCalls(t *testing.T) {
	resp := `{
		"message": {
			"content": "Let me search",
			"tool_calls": [
				{
					"function": {
						"name": "search",
						"arguments": {"query": "test"}
					}
				}
			]
		}
	}`
	result, err := parseChatResponse([]byte(resp), "ollama")
	if err != nil {
		t.Fatalf("parseChatResponse: %v", err)
	}
	if result.Content != "Let me search" {
		t.Fatalf("content = %q, want 'Let me search'", result.Content)
	}
	if len(result.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(result.ToolCalls))
	}
	if result.ToolCalls[0].Name != "search" {
		t.Fatalf("tool call name = %q, want 'search'", result.ToolCalls[0].Name)
	}
}

func TestAnthropicIntegrationEndToEnd(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var body map[string]interface{}
		json.NewDecoder(r.Body).Decode(&body)

		// Verify system is at top level
		if sys, ok := body["system"].(string); !ok || sys == "" {
			t.Errorf("Anthropic request should have top-level system field")
			_ = sys
		}

		// Verify tools are present
		if tools, ok := body["tools"].([]interface{}); !ok || len(tools) == 0 {
			t.Errorf("Anthropic request should have tools")
		}

		w.Header().Set("Content-Type", "application/json")
		if callCount == 1 {
			w.Write([]byte(`{"content":[{"type":"tool_use","id":"tu_1","name":"search","input":{"query":"wiki"}}]}`))
		} else {
			w.Write([]byte(`{"content":[{"type":"text","text":"Here are the results."}]}`))
		}
	}))
	defer server.Close()

	client := NewClient(Config{
		Provider: "anthropic",
		BaseURL:  server.URL,
		APIKey:   "test-key",
		Model:    "claude-3-opus",
	})

	tools := []ToolDefinition{
		{Name: "search", Description: "Search wiki", Parameters: map[string]interface{}{"type": "object"}},
	}

	msgs := []Message{
		{Role: "system", Content: "You are a wiki assistant."},
		{Role: "user", Content: "search my wiki"},
	}

	result, err := RunToolLoop(
		context.Background(),
		client,
		&stubToolExec{},
		msgs,
		tools,
		0.6,
		2048,
		ToolLoopConfig{MaxRounds: 4, MaxToolCallsPerRound: 2},
	)
	if err != nil {
		t.Fatalf("RunToolLoop: %v", err)
	}
	if result != "Here are the results." {
		t.Fatalf("result = %q, want 'Here are the results.'", result)
	}
	if callCount != 2 {
		t.Fatalf("expected 2 calls, got %d", callCount)
	}
}

// stubToolExec is a test double for ToolExecutor
type stubToolExec struct{}

func (e *stubToolExec) Execute(ctx context.Context, name string, argsJSON string) (string, error) {
	return "tool result for " + name, nil
}

func (e *stubToolExec) ListTools(ctx context.Context) ([]ToolDefinition, error) {
	return nil, nil
}
