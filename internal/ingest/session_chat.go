package ingest

import (
	"fmt"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const ingestSessionSystemPrompt = `You are an assistant helping the user explore and refine knowledge before it is archived into their personal LLM Wiki.

Your goals:
- Help clarify topics, definitions, and structure
- Ask focused follow-up questions when useful
- Summarize key points when asked
- Do not invent facts; say when uncertain

The user may upload attachments; their summaries appear in the conversation.
When the user is satisfied, they will click Archive to persist this thread into the wiki.`

// AssembleIngestChatMessages builds LLM messages from session history.
func AssembleIngestChatMessages(history []sqlite.IngestSessionMessage, userContent string) []llm.Message {
	out := make([]llm.Message, 0, len(history)+2)
	out = append(out, llm.Message{Role: "system", Content: ingestSessionSystemPrompt})
	for _, m := range history {
		if m.StreamStatus == "streaming" {
			continue
		}
		if strings.TrimSpace(m.Content) == "" && m.MessageType != "attachment_summary" {
			continue
		}
		role := m.Role
		if role != "user" && role != "assistant" && role != "system" {
			continue
		}
		content := m.Content
		if m.MessageType == "attachment_summary" {
			content = fmt.Sprintf("[Attachment summary]\n%s", content)
		}
		out = append(out, llm.Message{Role: role, Content: content})
	}
	if strings.TrimSpace(userContent) != "" {
		out = append(out, llm.Message{Role: "user", Content: userContent})
	}
	return truncateMessages(out, 48)
}

func truncateMessages(msgs []llm.Message, maxMessages int) []llm.Message {
	if len(msgs) <= maxMessages {
		return msgs
	}
	// Keep system + tail
	if len(msgs) == 0 {
		return msgs
	}
	system := msgs[0]
	tail := msgs[len(msgs)-maxMessages+1:]
	return append([]llm.Message{system}, tail...)
}

// AttachmentSummaryPrompt builds a user prompt for attachment understanding.
func AttachmentSummaryPrompt(filename, extracted string) string {
	if strings.TrimSpace(extracted) == "" {
		return fmt.Sprintf(
			"The user uploaded file %q. No text could be extracted. Write a brief assistant message in Chinese acknowledging the upload and suggesting what the user might want to discuss about this file. Keep under 120 words.",
			filename,
		)
	}
	if len(extracted) > 6000 {
		extracted = extracted[:6000] + "\n...(truncated)"
	}
	return fmt.Sprintf(
		"The user uploaded file %q. Extracted content:\n\n%s\n\nSummarize the key points in Chinese for the user (under 200 words). Mention filename.",
		filename, extracted,
	)
}
