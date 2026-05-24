package ingest

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

func TestStripToolMessages(t *testing.T) {
	tests := []struct {
		name  string
		input []llm.Message
		want  []llm.Message
	}{
		{
			name:  "empty input",
			input: nil,
			want:  nil,
		},
		{
			name: "plain conversation unchanged",
			input: []llm.Message{
				{Role: "system", Content: "you are helpful"},
				{Role: "user", Content: "hello"},
				{Role: "assistant", Content: "hi there"},
			},
			want: []llm.Message{
				{Role: "system", Content: "you are helpful"},
				{Role: "user", Content: "hello"},
				{Role: "assistant", Content: "hi there"},
			},
		},
		{
			name: "removes tool messages and strips tool_calls",
			input: []llm.Message{
				{Role: "system", Content: "system"},
				{Role: "user", Content: "user msg"},
				{Role: "assistant", Content: "let me check", ToolCalls: []llm.ToolCall{
					{ID: "call_1", Name: "structure", Arguments: "{}"},
					{ID: "call_2", Name: "audit", Arguments: "{}"},
				}},
				{Role: "tool", Content: "structure result", ToolCallID: "call_1", Name: "structure"},
				{Role: "tool", Content: "audit result", ToolCallID: "call_2", Name: "audit"},
			},
			want: []llm.Message{
				{Role: "system", Content: "system"},
				{Role: "user", Content: "user msg"},
				{Role: "assistant", Content: "let me check"},
			},
		},
		{
			name: "multiple consecutive tool messages removed",
			input: []llm.Message{
				{Role: "user", Content: "q"},
				{Role: "assistant", Content: "", ToolCalls: []llm.ToolCall{
					{ID: "c1", Name: "search", Arguments: `{"query":"test"}`},
				}},
				{Role: "tool", Content: "result 1", ToolCallID: "c1"},
				{Role: "tool", Content: "result 2", ToolCallID: "c2"},
				{Role: "tool", Content: "result 3", ToolCallID: "c3"},
			},
			want: []llm.Message{
				{Role: "user", Content: "q"},
				{Role: "assistant", Content: ""},
			},
		},
		{
			name: "assistant without tool_calls passed through",
			input: []llm.Message{
				{Role: "user", Content: "hello"},
				{Role: "assistant", Content: "world"},
			},
			want: []llm.Message{
				{Role: "user", Content: "hello"},
				{Role: "assistant", Content: "world"},
			},
		},
		{
			name: "multi-round tool conversation fully stripped",
			input: []llm.Message{
				{Role: "system", Content: "sys"},
				{Role: "user", Content: "organize"},
				{Role: "assistant", Content: "checking", ToolCalls: []llm.ToolCall{
					{ID: "c1", Name: "structure", Arguments: "{}"},
				}},
				{Role: "tool", Content: "tree result", ToolCallID: "c1"},
				{Role: "assistant", Content: "now auditing", ToolCalls: []llm.ToolCall{
					{ID: "c2", Name: "audit", Arguments: "{}"},
				}},
				{Role: "tool", Content: "audit result", ToolCallID: "c2"},
			},
			want: []llm.Message{
				{Role: "system", Content: "sys"},
				{Role: "user", Content: "organize"},
				{Role: "assistant", Content: "checking"},
				{Role: "assistant", Content: "now auditing"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := StripToolMessages(tt.input)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d messages, want %d", len(got), len(tt.want))
			}
			for i, m := range got {
				w := tt.want[i]
				if m.Role != w.Role {
					t.Errorf("msg[%d].Role = %q, want %q", i, m.Role, w.Role)
				}
				if m.Content != w.Content {
					t.Errorf("msg[%d].Content = %q, want %q", i, m.Content, w.Content)
				}
				if len(m.ToolCalls) != 0 {
					t.Errorf("msg[%d].ToolCalls should be empty, got %d calls", i, len(m.ToolCalls))
				}
				if m.ToolCallID != "" {
					t.Errorf("msg[%d].ToolCallID should be empty, got %q", i, m.ToolCallID)
				}
			}
		})
	}
}
