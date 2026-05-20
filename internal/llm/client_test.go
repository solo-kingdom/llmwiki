package llm

import (
	"context"
	"strings"
	"testing"
)

func TestStreamChatRejectsEmptyBaseURL(t *testing.T) {
	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  "",
		APIKey:   "sk-test",
		Model:    "gpt-4o",
	})
	_, err := c.StreamChat(context.Background(), []Message{{Role: "user", Content: "hi"}}, 0.7, 100)
	if err == nil {
		t.Fatal("expected error for empty base URL")
	}
	if !strings.Contains(err.Error(), "base URL") {
		t.Fatalf("expected base URL hint, got: %v", err)
	}
	if strings.Contains(err.Error(), "unsupported protocol scheme") {
		t.Fatalf("should fail before HTTP client, got: %v", err)
	}
}

func TestStreamChatRejectsRelativeBaseURL(t *testing.T) {
	c := NewClient(Config{
		Provider: "openai",
		BaseURL:  "/v1",
		APIKey:   "sk-test",
		Model:    "gpt-4o",
	})
	_, err := c.StreamChat(context.Background(), []Message{{Role: "user", Content: "hi"}}, 0.7, 100)
	if err == nil {
		t.Fatal("expected error for invalid base URL")
	}
	if !strings.Contains(err.Error(), "http") {
		t.Fatalf("expected http(s) URL requirement, got: %v", err)
	}
}
