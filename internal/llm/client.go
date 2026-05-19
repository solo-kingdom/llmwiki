package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
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

func (c *Client) StreamChat(ctx context.Context, messages []Message, temperature float64, maxTokens int) (<-chan StreamEvent, error) {
	url := c.buildURL()
	body, err := c.buildRequestBody(messages, temperature, maxTokens)
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

func (c *Client) buildRequestBody(messages []Message, temperature float64, maxTokens int) ([]byte, error) {
	switch c.config.Provider {
	case "anthropic":
		type anthropicReq struct {
			Model     string    `json:"model"`
			Messages  []Message `json:"messages"`
			MaxTokens int       `json:"max_tokens"`
			Stream    bool      `json:"stream"`
		}
		mt := maxTokens
		if mt <= 0 {
			mt = 4096
		}
		return json.Marshal(anthropicReq{
			Model:     c.config.Model,
			Messages:  messages,
			MaxTokens: mt,
			Stream:    true,
		})
	case "ollama":
		type ollamaReq struct {
			Model    string    `json:"model"`
			Messages []Message `json:"messages"`
			Stream   bool      `json:"stream"`
		}
		return json.Marshal(ollamaReq{
			Model:    c.config.Model,
			Messages: messages,
			Stream:   true,
		})
	default:
		type openaiReq struct {
			Model       string    `json:"model"`
			Messages    []Message `json:"messages"`
			Temperature float64   `json:"temperature"`
			MaxTokens   int       `json:"max_tokens,omitempty"`
			Stream      bool      `json:"stream"`
		}
		return json.Marshal(openaiReq{
			Model:       c.config.Model,
			Messages:    messages,
			Temperature: temperature,
			MaxTokens:   maxTokens,
			Stream:      true,
		})
	}
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
