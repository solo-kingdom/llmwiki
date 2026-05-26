import type { IngestSessionMessage } from "@/types"

export interface SessionMessageCopyLabels {
  user: string
  assistant: string
  attachment: string
}

function messageCopyText(msg: IngestSessionMessage): string {
  const content = msg.content?.trim() ?? ""
  if (content) return content
  if (msg.error_message?.trim()) return msg.error_message.trim()
  return ""
}

function formatWikiRefs(msg: IngestSessionMessage): string {
  if (!msg.wiki_refs?.length) return ""
  return msg.wiki_refs
    .map((ref) => `- ${ref.title || ref.relative_path}`)
    .join("\n")
}

function formatMessageBlock(
  msg: IngestSessionMessage,
  labels: SessionMessageCopyLabels,
): string | null {
  if (msg.role === "system") return null

  if (msg.role === "user") {
    const text = messageCopyText(msg)
    const refs = formatWikiRefs(msg)
    const body = [text, refs].filter(Boolean).join("\n")
    if (!body) return null
    return `${labels.user}: ${body}`
  }

  if (msg.role === "assistant") {
    const text = messageCopyText(msg)
    if (!text) return null
    if (msg.message_type === "attachment_summary") {
      return `${labels.attachment}: ${text}`
    }
    return `${labels.assistant}: ${text}`
  }

  return null
}

export function hasCopyableSessionMessages(
  messages: IngestSessionMessage[],
): boolean {
  return messages.some(
    (msg) => formatMessageBlock(msg, { user: "", assistant: "", attachment: "" }) !== null,
  )
}

export function formatSessionMessagesForCopy(
  messages: IngestSessionMessage[],
  labels: SessionMessageCopyLabels,
): string {
  return messages
    .map((msg) => formatMessageBlock(msg, labels))
    .filter((block): block is string => block !== null)
    .join("\n\n")
}
