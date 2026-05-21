package ingest

import (
	"fmt"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// AssembleIngestChatMessages builds LLM messages from session history.
func AssembleIngestChatMessages(history []sqlite.IngestSessionMessage, userContent, docLang, workspace, rulesSupplement string) []llm.Message {
	out := make([]llm.Message, 0, len(history)+2)
	ctx := PromptContext{
		Workspace:       workspace,
		DocLang:         docLang,
		RulesSupplement: rulesSupplement,
	}
	systemPrompt := ComposeSystemPrompt(StepSessionChat, ctx)
	out = append(out, llm.Message{Role: "system", Content: systemPrompt})
	for _, m := range history {
		if m.StreamStatus == "streaming" {
			continue
		}
		if m.Role == "assistant" && (m.StreamStatus == "failed" || m.StreamStatus == "incomplete") {
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
			content = fmt.Sprintf("[附件摘要]\n%s", content)
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
	if len(msgs) == 0 {
		return msgs
	}
	system := msgs[0]
	tail := msgs[len(msgs)-maxMessages+1:]
	return append([]llm.Message{system}, tail...)
}

// AttachmentSummaryPrompt builds a user prompt for attachment understanding.
func AttachmentSummaryPrompt(filename, extracted, docLang string) string {
	if docLang == "en" {
		return attachmentSummaryPromptEN(filename, extracted)
	}
	return attachmentSummaryPromptZH(filename, extracted)
}

func attachmentSummaryPromptZH(filename, extracted string) string {
	if strings.TrimSpace(extracted) == "" {
		return fmt.Sprintf(
			"用户上传了文件 %q，未能提取文本。请用中文简短回复（不超过 120 字），确认收到并建议用户可讨论的方向。不要编造文件内容。",
			filename,
		)
	}
	if len(extracted) > 6000 {
		extracted = extracted[:6000] + "\n...(已截断)"
	}
	return fmt.Sprintf(
		"用户上传了文件 %q。提取内容：\n\n%s\n\n请用中文总结要点（不超过 200 字），并提及文件名。仅总结附件中的内容，不要补充附件未提及的信息。",
		filename, extracted,
	)
}

func attachmentSummaryPromptEN(filename, extracted string) string {
	if strings.TrimSpace(extracted) == "" {
		return fmt.Sprintf(
			"The user uploaded %q but no text could be extracted. Reply briefly in English (under 120 words), acknowledge the upload, and suggest discussion topics. Do not invent file content.",
			filename,
		)
	}
	if len(extracted) > 6000 {
		extracted = extracted[:6000] + "\n...(truncated)"
	}
	return fmt.Sprintf(
		"The user uploaded %q. Extracted content:\n\n%s\n\nSummarize key points in English (under 200 words) and mention the filename. Only summarize the attachment text; do not add information not present in the file.",
		filename, extracted,
	)
}
