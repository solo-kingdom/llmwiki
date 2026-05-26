package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Message struct {
	Role              string     `json:"role"`
	Content           string     `json:"content,omitempty"`
	ReasoningContent  string     `json:"reasoning_content,omitempty"`
	ToolCallID        string     `json:"tool_call_id,omitempty"`
	Name              string     `json:"name,omitempty"`
	ToolCalls         []ToolCall `json:"tool_calls,omitempty"`
}

type StreamEvent struct {
	Type    string
	Content string
	Error   error
}

type Config struct {
	Provider          string
	BaseURL           string
	APIKey            string
	Model             string
	Timeout           time.Duration
	StreamIdleTimeout time.Duration
}

func DefaultConfig() Config {
	return Config{
		Provider:          "openai",
		BaseURL:           "https://api.openai.com/v1",
		Model:             "gpt-4o",
		Timeout:           30 * time.Minute,
		StreamIdleTimeout: 2 * time.Minute,
	}
}

type Client struct {
	config     Config
	httpClient *http.Client
}

func NewClient(cfg Config) *Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Minute
	}
	if cfg.StreamIdleTimeout == 0 {
		cfg.StreamIdleTimeout = 2 * time.Minute
	}
	return &Client{
		config: cfg,
		httpClient: &http.Client{
			Timeout: cfg.Timeout,
		},
	}
}

// Model returns the configured model name.
func (c *Client) Model() string {
	if c == nil {
		return ""
	}
	return c.config.Model
}

func (c *Client) validateRequest() error {
	if strings.TrimSpace(c.config.Model) == "" {
		return fmt.Errorf("model is not configured")
	}
	base := strings.TrimSpace(c.config.BaseURL)
	if base == "" {
		return fmt.Errorf(
			"provider base URL is not configured; set it in Settings under Provider instances",
		)
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf(
			"provider base URL must be a valid http(s) URL (got %q); configure it in Settings",
			c.config.BaseURL,
		)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf(
			"provider base URL must use http or https (got %q)",
			parsed.Scheme,
		)
	}
	return nil
}

// Chat performs a non-streaming completion, optionally with tools (OpenAI-compatible).
func (c *Client) Chat(ctx context.Context, messages []Message, tools []ToolDefinition, temperature float64, maxTokens int, opts ...ChatOptions) (ChatResult, error) {
	if err := c.validateRequest(); err != nil {
		return ChatResult{}, err
	}
	var toolChoice string
	if len(opts) > 0 {
		toolChoice = opts[0].ToolChoice
	}
	url := c.buildURL()
	body, err := c.buildChatBody(messages, tools, temperature, maxTokens, false, toolChoice)
	if err != nil {
		return ChatResult{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return ChatResult{}, fmt.Errorf("create request: %w", err)
	}
	c.setHeaders(httpReq)
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return ChatResult{}, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return ChatResult{}, classifyError(resp.StatusCode, string(data))
	}
	return parseChatResponse(data, c.config.Provider)
}

func (c *Client) StreamChat(ctx context.Context, messages []Message, temperature float64, maxTokens int) (<-chan StreamEvent, error) {
	if err := c.validateRequest(); err != nil {
		return nil, err
	}
	url := c.buildURL()
	body, err := c.buildChatBody(messages, nil, temperature, maxTokens, true, "")
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}

	ch := make(chan StreamEvent, 100)
	go c.readStream(resp, ch)
	return ch, nil
}

func (c *Client) buildURL() string {
	base := strings.TrimRight(c.config.BaseURL, "/")
	switch c.config.Provider {
	case "openai":
		return base + "/chat/completions"
	case "anthropic":
		return base + "/messages"
	case "ollama":
		return base + "/api/chat"
	default:
		return base + "/chat/completions"
	}
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	switch c.config.Provider {
	case "anthropic":
		if c.config.APIKey != "" {
			req.Header.Set("x-api-key", c.config.APIKey)
		}
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		if c.config.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
		}
	}
}

func (c *Client) buildChatBody(messages []Message, tools []ToolDefinition, temperature float64, maxTokens int, stream bool, toolChoice string) ([]byte, error) {
	switch c.config.Provider {
	case "anthropic":
		type anthropicTool struct {
			Name        string                 `json:"name"`
			Description string                 `json:"description"`
			InputSchema map[string]interface{} `json:"input_schema"`
		}
		type anthropicReq struct {
			Model     string          `json:"model"`
			System    string          `json:"system,omitempty"`
			Messages  []Message       `json:"messages"`
			MaxTokens int             `json:"max_tokens"`
			Stream    bool            `json:"stream"`
			Tools     []anthropicTool `json:"tools,omitempty"`
			ToolChoice interface{}    `json:"tool_choice,omitempty"`
		}
		mt := maxTokens
		if mt <= 0 {
			mt = 4096
		}

		// Extract system messages to top-level system field
		var systemText string
		var filtered []Message
		for _, m := range messages {
			if m.Role == "system" {
				if systemText != "" {
					systemText += "\n\n"
				}
				systemText += m.Content
			} else {
				filtered = append(filtered, m)
			}
		}

		// Convert tool messages to Anthropic format
		anthropicMsgs := convertToAnthropicMessages(filtered)

		req := anthropicReq{
			Model:     c.config.Model,
			System:    systemText,
			Messages:  anthropicMsgs,
			MaxTokens: mt,
			Stream:    stream,
		}

		// Convert tools to Anthropic format
		for _, t := range tools {
			at := anthropicTool{
				Name:        t.Name,
				Description: t.Description,
				InputSchema: t.Parameters,
			}
			if at.InputSchema == nil {
				at.InputSchema = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
			}
			req.Tools = append(req.Tools, at)
		}

		if toolChoice == "required" && len(req.Tools) > 0 {
			req.ToolChoice = map[string]string{"type": "any"}
		} else if toolChoice == "auto" && len(req.Tools) > 0 {
			req.ToolChoice = map[string]string{"type": "auto"}
		}

		return json.Marshal(req)
	case "ollama":
		type ollamaTool struct {
			Type     string `json:"type"`
			Function struct {
				Name        string                 `json:"name"`
				Description string                 `json:"description"`
				Parameters  map[string]interface{} `json:"parameters"`
			} `json:"function"`
		}
		type ollamaReq struct {
			Model    string       `json:"model"`
			Messages []Message    `json:"messages"`
			Stream   bool         `json:"stream"`
			Tools    []ollamaTool `json:"tools,omitempty"`
		}
		req := ollamaReq{
			Model:    c.config.Model,
			Messages: messages,
			Stream:   stream,
		}
		for _, t := range tools {
			ot := ollamaTool{Type: "function"}
			ot.Function.Name = t.Name
			ot.Function.Description = t.Description
			ot.Function.Parameters = t.Parameters
			if ot.Function.Parameters == nil {
				ot.Function.Parameters = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
			}
			req.Tools = append(req.Tools, ot)
		}
		return json.Marshal(req)
	default:
		type openaiTool struct {
			Type     string `json:"type"`
			Function struct {
				Name        string                 `json:"name"`
				Description string                 `json:"description"`
				Parameters  map[string]interface{} `json:"parameters"`
			} `json:"function"`
		}
		type openaiReq struct {
			Model       string       `json:"model"`
			Messages    []Message    `json:"messages"`
			Temperature float64      `json:"temperature"`
			MaxTokens   int          `json:"max_tokens,omitempty"`
			Stream      bool         `json:"stream"`
			Tools       []openaiTool `json:"tools,omitempty"`
			ToolChoice  interface{}  `json:"tool_choice,omitempty"`
		}
		req := openaiReq{
			Model:       c.config.Model,
			Messages:    messages,
			Temperature: temperature,
			MaxTokens:   maxTokens,
			Stream:      stream,
		}
		for _, t := range tools {
			ot := openaiTool{Type: "function"}
			ot.Function.Name = t.Name
			ot.Function.Description = t.Description
			ot.Function.Parameters = t.Parameters
			if ot.Function.Parameters == nil {
				ot.Function.Parameters = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
			}
			req.Tools = append(req.Tools, ot)
		}
		if toolChoice != "" {
			req.ToolChoice = map[string]string{"type": toolChoice}
		}
		return json.Marshal(req)
	}
}

func parseChatResponse(data []byte, provider string) (ChatResult, error) {
	switch provider {
	case "anthropic":
		// Anthropic returns content as an array of content blocks
		var resp struct {
			Content []struct {
				Type  string `json:"type"`
				Text  string `json:"text"`
				ID    string `json:"id"`
				Name  string `json:"name"`
				Input json.RawMessage `json:"input"`
			} `json:"content"`
		}
		if err := json.Unmarshal(data, &resp); err != nil {
			return ChatResult{}, err
		}
		var textParts []string
		var toolCalls []ToolCall
		for _, block := range resp.Content {
			switch block.Type {
			case "text":
				textParts = append(textParts, block.Text)
			case "tool_use":
				toolCalls = append(toolCalls, ToolCall{
					ID:        block.ID,
					Name:      block.Name,
					Arguments: string(block.Input),
				})
			}
		}
		return ChatResult{
			Content:   strings.Join(textParts, ""),
			ToolCalls: toolCalls,
		}, nil
	case "ollama":
		var resp struct {
			Content string `json:"content"`
			Message struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					Function struct {
						Name      string `json:"name"`
						Arguments json.RawMessage `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		}
		if err := json.Unmarshal(data, &resp); err != nil {
			return ChatResult{}, err
		}
		text := resp.Content
		if text == "" {
			text = resp.Message.Content
		}
		var calls []ToolCall
		for _, tc := range resp.Message.ToolCalls {
			calls = append(calls, ToolCall{
				Name:      tc.Function.Name,
				Arguments: string(tc.Function.Arguments),
			})
		}
		return ChatResult{Content: text, ToolCalls: calls}, nil
	default:
		var resp struct {
			Choices []struct {
				Message struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
					ToolCalls []struct {
						ID       string `json:"id"`
						Type     string `json:"type"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(data, &resp); err != nil {
			return ChatResult{}, err
		}
		if len(resp.Choices) == 0 {
			return ChatResult{}, fmt.Errorf("empty chat response")
		}
		msg := resp.Choices[0].Message
		var calls []ToolCall
		for _, tc := range msg.ToolCalls {
			calls = append(calls, ToolCall{
				ID:        tc.ID,
				Name:      tc.Function.Name,
				Arguments: tc.Function.Arguments,
			})
		}
		return ChatResult{
			Content:          msg.Content,
			ReasoningContent: msg.ReasoningContent,
			ToolCalls:        calls,
		}, nil
	}
}

// convertToAnthropicMessages converts OpenAI-style messages to Anthropic format.
// Key differences:
// - tool result messages become user messages with tool_result content blocks
// - assistant messages with ToolCalls become content arrays with tool_use blocks
func convertToAnthropicMessages(msgs []Message) []Message {
	var result []Message

	// Buffer to accumulate consecutive tool results into a single user message
	var pendingToolResults []json.RawMessage

	flushToolResults := func() {
		if len(pendingToolResults) == 0 {
			return
		}
		content, _ := json.Marshal(pendingToolResults)
		result = append(result, Message{
			Role:    "user",
			Content: string(content),
		})
		pendingToolResults = nil
	}

	for _, m := range msgs {
		switch m.Role {
		case "tool":
			// Convert to Anthropic tool_result format
			tr := map[string]interface{}{
				"type":      "tool_result",
				"tool_use_id": m.ToolCallID,
				"content":   m.Content,
			}
			data, _ := json.Marshal(tr)
			pendingToolResults = append(pendingToolResults, data)

		case "assistant":
			flushToolResults()

			if len(m.ToolCalls) > 0 {
				// Build Anthropic content array: tool_use blocks + text
				var contentBlocks []json.RawMessage
				for _, tc := range m.ToolCalls {
					var input interface{}
					if tc.Arguments != "" {
						_ = json.Unmarshal([]byte(tc.Arguments), &input)
					}
					if input == nil {
						input = map[string]interface{}{}
					}
					block := map[string]interface{}{
						"type":  "tool_use",
						"id":    tc.ID,
						"name":  tc.Name,
						"input": input,
					}
					data, _ := json.Marshal(block)
					contentBlocks = append(contentBlocks, data)
				}
				if m.Content != "" {
					textBlock := map[string]interface{}{
						"type": "text",
						"text": m.Content,
					}
					data, _ := json.Marshal(textBlock)
					// Text goes first, then tool_use
					contentBlocks = append([]json.RawMessage{data}, contentBlocks...)
				}
				content, _ := json.Marshal(contentBlocks)
				result = append(result, Message{
					Role:    "assistant",
					Content: string(content),
				})
			} else {
				result = append(result, m)
			}

		default:
			flushToolResults()
			result = append(result, m)
		}
	}
	flushToolResults()

	return result
}

func classifyError(statusCode int, body string) error {
	switch {
	case statusCode == 401 || statusCode == 403:
		return fmt.Errorf("authentication error (HTTP %d): %s", statusCode, truncate(body, 200))
	case statusCode == 429:
		return fmt.Errorf("rate limit exceeded (HTTP %d): %s", statusCode, truncate(body, 200))
	case statusCode == 400:
		if strings.Contains(body, "context_length") || strings.Contains(body, "max_tokens") || strings.Contains(body, "token limit") {
			return fmt.Errorf("context length exceeded (HTTP %d): %s", statusCode, truncate(body, 200))
		}
		return fmt.Errorf("bad request (HTTP %d): %s", statusCode, truncate(body, 200))
	case statusCode >= 500:
		return fmt.Errorf("server error (HTTP %d): %s", statusCode, truncate(body, 200))
	default:
		return fmt.Errorf("API error (HTTP %d): %s", statusCode, truncate(body, 200))
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func (c *Client) readStream(resp *http.Response, ch chan<- StreamEvent) {
	defer close(ch)
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		ch <- StreamEvent{Type: "error", Error: classifyError(resp.StatusCode, string(body))}
		return
	}

	switch c.config.Provider {
	case "anthropic":
		c.readSSEAnthropic(resp.Body, ch)
	case "ollama":
		c.readJSONLines(resp.Body, ch)
	default:
		c.readSSEOpenAI(resp.Body, ch)
	}
}

func (c *Client) readSSEOpenAI(body io.Reader, ch chan<- StreamEvent) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			ch <- StreamEvent{Type: "done"}
			return
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				ch <- StreamEvent{Type: "token", Content: choice.Delta.Content}
			}
			if choice.FinishReason != nil && *choice.FinishReason != "" {
				ch <- StreamEvent{Type: "done"}
				return
			}
		}
	}
	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Type: "error", Error: fmt.Errorf("stream read error: %w", err)}
		return
	}
	ch <- StreamEvent{Type: "done"}
}

func (c *Client) readSSEAnthropic(body io.Reader, ch chan<- StreamEvent) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var eventData string
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "data: ") {
			eventData = strings.TrimPrefix(line, "data: ")
			continue
		}

		if line == "" && eventData != "" {
			var chunk struct {
				Type  string `json:"type"`
				Delta struct {
					Text string `json:"text"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(eventData), &chunk); err != nil {
				eventData = ""
				continue
			}
			switch chunk.Type {
			case "content_block_delta":
				if chunk.Delta.Text != "" {
					ch <- StreamEvent{Type: "token", Content: chunk.Delta.Text}
				}
			case "message_stop":
				ch <- StreamEvent{Type: "done"}
				return
			case "error":
				ch <- StreamEvent{Type: "error", Error: fmt.Errorf("anthropic stream error: %s", eventData)}
				return
			}
			eventData = ""
		}
	}
	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Type: "error", Error: fmt.Errorf("stream read error: %w", err)}
		return
	}
	ch <- StreamEvent{Type: "done"}
}

func (c *Client) readJSONLines(body io.Reader, ch chan<- StreamEvent) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var chunk struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Done    bool   `json:"done"`
			Error   string `json:"error"`
		}
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			continue
		}
		if chunk.Error != "" {
			ch <- StreamEvent{Type: "error", Error: fmt.Errorf("ollama error: %s", chunk.Error)}
			return
		}
		if chunk.Message.Content != "" {
			ch <- StreamEvent{Type: "token", Content: chunk.Message.Content}
		}
		if chunk.Done {
			ch <- StreamEvent{Type: "done"}
			return
		}
	}
	if err := scanner.Err(); err != nil {
		ch <- StreamEvent{Type: "error", Error: fmt.Errorf("stream read error: %w", err)}
		return
	}
	ch <- StreamEvent{Type: "done"}
}
