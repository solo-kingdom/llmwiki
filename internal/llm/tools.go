package llm

import (
	"context"
	"encoding/json"
	"fmt"
)

// ToolDefinition describes a callable tool for the chat API.
type ToolDefinition struct {
	Name        string
	Description string
	Parameters  map[string]interface{}
}

// ToolCall is a model-requested tool invocation.
type ToolCall struct {
	ID        string
	Name      string
	Arguments string
}

// MarshalJSON serializes ToolCall in OpenAI Chat Completions tool_calls format.
func (tc ToolCall) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}{
		ID:   tc.ID,
		Type: "function",
		Function: struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		}{
			Name:      tc.Name,
			Arguments: tc.Arguments,
		},
	})
}

// UnmarshalJSON parses OpenAI Chat Completions tool_calls format into ToolCall.
func (tc *ToolCall) UnmarshalJSON(data []byte) error {
	var raw struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	tc.ID = raw.ID
	tc.Name = raw.Function.Name
	tc.Arguments = raw.Function.Arguments
	return nil
}

// ChatResult is a non-streaming completion result.
type ChatResult struct {
	Content   string
	ToolCalls []ToolCall
}

// ToolExecutor runs a tool by name and returns text for the model.
type ToolExecutor interface {
	Execute(ctx context.Context, name string, argsJSON string) (string, error)
	ListTools(ctx context.Context) ([]ToolDefinition, error)
}

// ChatOptions holds optional parameters for Client.Chat.
type ChatOptions struct {
	ToolChoice string // "" | "auto" | "required" | "none"
}

// ToolLoopConfig limits automatic tool-call rounds.
type ToolLoopConfig struct {
	MaxRounds              int
	MaxToolCallsPerRound   int
}

// DefaultToolLoopConfig returns safe defaults from the design doc.
func DefaultToolLoopConfig() ToolLoopConfig {
	return ToolLoopConfig{
		MaxRounds:            12,
		MaxToolCallsPerRound: 4,
	}
}

// RunToolLoop runs chat with optional tools until the model returns text or limits hit.
func RunToolLoop(
	ctx context.Context,
	client *Client,
	executor ToolExecutor,
	messages []Message,
	tools []ToolDefinition,
	temperature float64,
	maxTokens int,
	cfg ToolLoopConfig,
) (string, error) {
	if client == nil {
		return "", fmt.Errorf("LLM client is nil")
	}
	if cfg.MaxRounds <= 0 {
		cfg.MaxRounds = DefaultToolLoopConfig().MaxRounds
	}
	if cfg.MaxToolCallsPerRound <= 0 {
		cfg.MaxToolCallsPerRound = DefaultToolLoopConfig().MaxToolCallsPerRound
	}

	msgs := append([]Message(nil), messages...)
	useTools := len(tools) > 0 && executor != nil

	for round := 0; round < cfg.MaxRounds; round++ {
		var result ChatResult
		var err error
		if useTools {
			result, err = client.Chat(ctx, msgs, tools, temperature, maxTokens)
		} else {
			result, err = client.Chat(ctx, msgs, nil, temperature, maxTokens)
		}
		if err != nil {
			return "", err
		}
		if len(result.ToolCalls) == 0 {
			return result.Content, nil
		}
		if !useTools {
			return result.Content, nil
		}

		// Append assistant message with tool calls (OpenAI-style)
		msgs = append(msgs, Message{Role: "assistant", Content: result.Content, ToolCalls: result.ToolCalls})

		calls := result.ToolCalls
		if len(calls) > cfg.MaxToolCallsPerRound {
			calls = calls[:cfg.MaxToolCallsPerRound]
		}
		for _, tc := range calls {
			var args map[string]interface{}
			if tc.Arguments != "" {
				_ = json.Unmarshal([]byte(tc.Arguments), &args)
			}
			out, execErr := executor.Execute(ctx, tc.Name, tc.Arguments)
			if execErr != nil {
				out = fmt.Sprintf("tool error: %v", execErr)
			}
			msgs = append(msgs, Message{
				Role:       "tool",
				Content:    out,
				ToolCallID: tc.ID,
				Name:       tc.Name,
			})
		}
	}
	return "", fmt.Errorf("tool loop exceeded max rounds (%d)", cfg.MaxRounds)
}
