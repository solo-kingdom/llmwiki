package ingest

import (
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func TestAssembleIngestChatMessagesSkipsFailedAssistant(t *testing.T) {
	history := []sqlite.IngestSessionMessage{
		{Role: "user", Content: "first", StreamStatus: "complete"},
		{Role: "assistant", Content: "error text", StreamStatus: "failed"},
		{Role: "user", Content: "second", StreamStatus: "complete"},
	}
	msgs := AssembleIngestChatMessages(history, "third", "zh")
	roles := make([]string, 0, len(msgs))
	for _, m := range msgs {
		if m.Role == "system" {
			continue
		}
		roles = append(roles, m.Role+":"+m.Content)
	}
	want := []string{"user:first", "user:second", "user:third"}
	if len(roles) != len(want) {
		t.Fatalf("got %d messages %v, want %v", len(roles), roles, want)
	}
	for i, w := range want {
		if roles[i] != w {
			t.Fatalf("roles[%d] = %q, want %q", i, roles[i], w)
		}
	}
}

func TestAssembleIngestChatMessagesLanguageInstruction(t *testing.T) {
	history := []sqlite.IngestSessionMessage{}
	msgs := AssembleIngestChatMessages(history, "", "zh")
	if len(msgs) < 1 || msgs[0].Role != "system" {
		t.Fatal("expected system message")
	}
	if !strings.Contains(msgs[0].Content, "中文") {
		t.Errorf("system prompt for zh should contain Chinese instruction, got: %s", msgs[0].Content)
	}

	msgsEN := AssembleIngestChatMessages(history, "", "en")
	if !strings.Contains(msgsEN[0].Content, "English") {
		t.Errorf("system prompt for en should contain English instruction, got: %s", msgsEN[0].Content)
	}
}

func TestAttachmentSummaryPromptLanguage(t *testing.T) {
	promptZH := AttachmentSummaryPrompt("test.pdf", "some content", "zh")
	if !strings.Contains(promptZH, "Chinese") {
		t.Errorf("zh prompt should mention Chinese, got: %s", promptZH)
	}

	promptEN := AttachmentSummaryPrompt("test.pdf", "some content", "en")
	if !strings.Contains(promptEN, "English") {
		t.Errorf("en prompt should mention English, got: %s", promptEN)
	}
}
