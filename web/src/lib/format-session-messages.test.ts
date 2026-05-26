import { describe, it, expect } from "vitest"
import {
  formatSessionMessagesForCopy,
  hasCopyableSessionMessages,
} from "@/lib/format-session-messages"
import type { IngestSessionMessage } from "@/types"

const labels = {
  user: "用户",
  assistant: "助手",
  attachment: "[附件]",
}

function msg(
  overrides: Partial<IngestSessionMessage> & Pick<IngestSessionMessage, "role">,
): IngestSessionMessage {
  return {
    id: "msg-1",
    session_id: "sess-1",
    content: "",
    message_type: "text",
    attachment_id: "",
    stream_status: "complete",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("formatSessionMessagesForCopy", () => {
  it("formats multi-turn conversation", () => {
    const text = formatSessionMessagesForCopy(
      [
        msg({ role: "user", content: "hello" }),
        msg({ role: "assistant", content: "hi there" }),
      ],
      labels,
    )
    expect(text).toBe("用户: hello\n\n助手: hi there")
  })

  it("skips system messages", () => {
    const text = formatSessionMessagesForCopy(
      [
        msg({ role: "system", content: "hidden" }),
        msg({ role: "user", content: "visible" }),
      ],
      labels,
    )
    expect(text).toBe("用户: visible")
  })

  it("appends wiki refs to user messages", () => {
    const text = formatSessionMessagesForCopy(
      [
        msg({
          role: "user",
          content: "explain alpha",
          wiki_refs: [
            {
              document_id: "doc-1",
              relative_path: "wiki/alpha.md",
              title: "Alpha Page",
            },
          ],
        }),
      ],
      labels,
    )
    expect(text).toBe("用户: explain alpha\n- Alpha Page")
  })

  it("formats attachment summary messages", () => {
    const text = formatSessionMessagesForCopy(
      [
        msg({
          role: "assistant",
          content: "Image shows a diagram",
          message_type: "attachment_summary",
        }),
      ],
      labels,
    )
    expect(text).toBe("[附件]: Image shows a diagram")
  })

  it("uses error_message when content is empty", () => {
    const text = formatSessionMessagesForCopy(
      [
        msg({
          role: "assistant",
          content: "",
          stream_status: "failed",
          error_message: "upstream timeout",
        }),
      ],
      labels,
    )
    expect(text).toBe("助手: upstream timeout")
  })

  it("includes streaming partial content", () => {
    const text = formatSessionMessagesForCopy(
      [
        msg({
          role: "assistant",
          content: "partial reply",
          stream_status: "streaming",
        }),
      ],
      labels,
    )
    expect(text).toBe("助手: partial reply")
  })
})

describe("hasCopyableSessionMessages", () => {
  it("returns false when no copyable messages exist", () => {
    expect(hasCopyableSessionMessages([])).toBe(false)
    expect(
      hasCopyableSessionMessages([
        msg({ role: "system", content: "hidden" }),
        msg({ role: "assistant", content: "  ", stream_status: "streaming" }),
      ]),
    ).toBe(false)
  })

  it("returns true when at least one message is copyable", () => {
    expect(
      hasCopyableSessionMessages([msg({ role: "user", content: "hello" })]),
    ).toBe(true)
  })
})
