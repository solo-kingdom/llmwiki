// Package llm provides LLM client integration.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Message represents a chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest is a request to a chat completion API.
type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	Stream      bool      `json:"stream"`
}

// StreamEvent represents a streaming response chunk.
type StreamEvent struct {
	Type    string // "token", "done", "error"
	Content string
	Error   error
}

// Config holds LLM provider configuration.
type Config struct {
	Provider  string // "openai", "anthropic", "ollama", "custom"
	BaseURL   string
	APIKey    string
	Model     string
	Timeout   time.Duration
}

// DefaultConfig returns a default OpenAI-compatible configuration.
func DefaultConfig() Config {
	return Config{
		Provider: "openai",
		BaseURL:  "https://api.openai.com/v1",
		Model:    "gpt-4o",
		Timeout:  30 * time.Minute,
	}
}

// Client is an LLM client supporting multiple providers.
type Client struct {
	config     Config
	httpClient *http.Client
}

// NewClient creates a new LLM client.
func NewClient(cfg Config) *Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Minute
	}
	return &Client{
		config: cfg,
		httpClient: &http.Client{
			Timeout: cfg.Timeout,
		},
	}
}

// StreamChat sends a chat request and streams the response.
func (c *Client) StreamChat(ctx context.Context, messages []Message, temperature float64, maxTokens int) (<-chan StreamEvent, error) {
	url := c.buildURL()

	req := ChatRequest{
		Model:       c.config.Model,
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		Stream:      true,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.config.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}

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
	case "anthropic":
		return base + "/v1/messages"
	case "ollama":
		return base + "/api/chat"
	default:
		return base + "/chat/completions"
	}
}

func (c *Client) readStream(resp *http.Response, ch chan<- StreamEvent) {
	defer close(ch)
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		ch <- StreamEvent{
			Type:  "error",
			Error: fmt.Errorf("API error %d: %s", resp.StatusCode, string(body)),
		}
		return
	}

	reader := io.Reader(resp.Body)
	buf := make([]byte, 4096)

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			ch <- StreamEvent{Type: "token", Content: string(buf[:n])}
		}
		if err != nil {
			if err == io.EOF {
				ch <- StreamEvent{Type: "done"}
			} else {
				ch <- StreamEvent{Type: "error", Error: err}
			}
			return
		}
	}
}
