import type { Message } from "../llm/types.js";
import type { IngestSessionMessage } from "../store/types.js";
import { composeSystemPrompt } from "./prompts.js";
import type { PromptStep } from "./types.js";

export function assembleIngestChatMessages(
  history: IngestSessionMessage[],
  userContent: string,
  docLang: string,
  workspace: string,
  rulesSupplement: string,
  relatedSubsetSection: string,
  step: PromptStep,
): Message[] {
  let systemPrompt = composeSystemPrompt(step, { workspace, docLang, rulesSupplement });
  if (relatedSubsetSection.trim()) systemPrompt += `\n\n${relatedSubsetSection.trim()}`;

  const out: Message[] = [{ role: "system", content: systemPrompt }];
  for (const message of history) {
    if (message.stream_status === "streaming") continue;
    if (
      message.role === "assistant" &&
      (message.stream_status === "failed" || message.stream_status === "incomplete")
    ) {
      continue;
    }
    if (!message.content.trim() && message.message_type !== "attachment_summary") continue;
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") continue;
    let content = message.content;
    if (message.message_type === "attachment_summary") content = `[附件摘要]\n${content}`;
    out.push({ role: message.role, content });
  }
  if (userContent.trim()) out.push({ role: "user", content: userContent });
  return truncateMessages(out, 48);
}

function truncateMessages(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) return messages;
  const system = messages[0];
  return system ? [system, ...messages.slice(messages.length - maxMessages + 1)] : messages;
}

export function attachmentSummaryPrompt(filename: string, extracted: string, docLang: string): string {
  if (docLang === "en") {
    if (!extracted.trim()) {
      return `The user uploaded "${filename}" but no text could be extracted. Reply briefly in English (under 120 words), acknowledge the upload, and suggest discussion topics. Do not invent file content.`;
    }
    const text = extracted.length > 6000 ? `${extracted.slice(0, 6000)}\n...(truncated)` : extracted;
    return `The user uploaded "${filename}". Extracted content:\n\n${text}\n\nSummarize key points in English (under 200 words) and mention the filename. Only summarize the attachment text; do not add information not present in the file.`;
  }
  if (!extracted.trim()) {
    return `用户上传了文件 "${filename}"，未能提取文本。请用中文简短回复（不超过 120 字），确认收到并建议用户可讨论的方向。不要编造文件内容。`;
  }
  const text = extracted.length > 6000 ? `${extracted.slice(0, 6000)}\n...(已截断)` : extracted;
  return `用户上传了文件 "${filename}"。提取内容：\n\n${text}\n\n请用中文总结要点（不超过 200 字），并提及文件名。仅总结附件中的内容，不要补充附件未提及的信息。`;
}
