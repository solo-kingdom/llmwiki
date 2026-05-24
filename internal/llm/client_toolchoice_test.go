package llm

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildChatBodyToolChoiceRequired(t *testing.T) {
	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1",
		APIKey:   "sk-test",
		Model:    "gpt-4o",
	})
	msgs := []Message{{Role: "user", Content: "hello"}}
	body, err := c.buildChatBody(msgs, nil, 0.7, 100, false, "required")
	if err != nil {
		t.Fatalf("buildChatBody: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("parse json: %v", err)
	}
	tc, ok := parsed["tool_choice"]
	if !ok {
		t.Fatal("tool_choice field missing from request body")
	}
	tcMap, ok := tc.(map[string]interface{})
	if !ok {
		t.Fatalf("tool_choice = %v, want map", tc)
	}
	if tcMap["type"] != "required" {
		t.Fatalf("tool_choice.type = %v, want %q", tcMap["type"], "required")
	}
}

func TestBuildChatBodyToolChoiceEmpty(t *testing.T) {
	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1",
		APIKey:   "sk-test",
		Model:    "gpt-4o",
	})
	msgs := []Message{{Role: "user", Content: "hello"}}
	body, err := c.buildChatBody(msgs, nil, 0.7, 100, false, "")
	if err != nil {
		t.Fatalf("buildChatBody: %v", err)
	}
	if strings.Contains(string(body), "tool_choice") {
		t.Fatal("tool_choice should not be present when empty")
	}
}

func TestBuildChatBodyToolChoiceAuto(t *testing.T) {
	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1",
		APIKey:   "sk-test",
		Model:    "gpt-4o",
	})
	msgs := []Message{{Role: "user", Content: "hello"}}
	body, err := c.buildChatBody(msgs, nil, 0.7, 100, false, "auto")
	if err != nil {
		t.Fatalf("buildChatBody: %v", err)
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("parse json: %v", err)
	}
	tc, ok := parsed["tool_choice"]
	if !ok {
		t.Fatal("tool_choice field missing from request body")
	}
	tcMap, ok := tc.(map[string]interface{})
	if !ok {
		t.Fatalf("tool_choice = %v, want map", tc)
	}
	if tcMap["type"] != "auto" {
		t.Fatalf("tool_choice.type = %v, want %q", tcMap["type"], "auto")
	}
}

func TestBuildChatBodyAnthropicIgnoresToolChoice(t *testing.T) {
	c := NewClient(Config{
		Provider: "anthropic",
		BaseURL:  "https://api.anthropic.com",
		APIKey:   "sk-test",
		Model:    "claude-3-opus",
	})
	msgs := []Message{{Role: "user", Content: "hello"}}
	body, err := c.buildChatBody(msgs, nil, 0.7, 100, false, "required")
	if err != nil {
		t.Fatalf("buildChatBody: %v", err)
	}
	if strings.Contains(string(body), "tool_choice") {
		t.Fatal("anthropic should ignore tool_choice in Phase 1")
	}
}
