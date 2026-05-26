package llm

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestToolCallMarshalJSONOpenAIFormat(t *testing.T) {
	tc := ToolCall{ID: "call_1", Name: "structure", Arguments: `{"path":"wiki"}`}
	data, err := json.Marshal(tc)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(data)
	if !strings.Contains(s, `"type":"function"`) {
		t.Errorf("missing type:function: %s", s)
	}
	if !strings.Contains(s, `"function"`) {
		t.Errorf("missing nested function object: %s", s)
	}
	if !strings.Contains(s, `"id":"call_1"`) {
		t.Errorf("missing id: %s", s)
	}
	if !strings.Contains(s, `"name":"structure"`) {
		t.Errorf("missing function name: %s", s)
	}
}

func TestToolCallUnmarshalJSONOpenAIFormat(t *testing.T) {
	raw := `{"id":"call_1","type":"function","function":{"name":"audit","arguments":"{}"}}`
	var tc ToolCall
	if err := json.Unmarshal([]byte(raw), &tc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if tc.ID != "call_1" || tc.Name != "audit" || tc.Arguments != "{}" {
		t.Fatalf("parsed ToolCall = %+v", tc)
	}
}

func TestToolCallJSONRoundTrip(t *testing.T) {
	original := ToolCall{ID: "call_abc", Name: "read", Arguments: `{"path":"wiki/foo.md"}`}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var parsed ToolCall
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed != original {
		t.Fatalf("round-trip mismatch: got %+v, want %+v", parsed, original)
	}
}

func TestMessageToolCallsMarshalOpenAIFormat(t *testing.T) {
	msg := Message{
		Role: "assistant",
		ToolCalls: []ToolCall{
			{ID: "call_1", Name: "structure", Arguments: "{}"},
		},
	}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(data)
	if !strings.Contains(s, `"type":"function"`) {
		t.Errorf("message tool_calls missing OpenAI format: %s", s)
	}
}
