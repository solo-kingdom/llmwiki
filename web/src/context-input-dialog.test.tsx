import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { ContextInputDialog } from "@/components/ContextInputDialog"
import * as api from "@/lib/api"

vi.mock("@/lib/api", () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
  listIngestJobs: vi.fn().mockResolvedValue([]),
  listIngestSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  getIngestSession: vi.fn().mockResolvedValue({
    session: {
      id: "sess-1",
      title: "",
      status: "active",
      mode: "chat",
      storage_path: "",
      llm_instance_id: "",
      llm_model: "",
      created_at: "",
      updated_at: "",
    },
  }),
  listIngestSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
  appendIngestSessionMessage: vi.fn(),
  getCapabilities: vi.fn().mockResolvedValue({
    file_types: [],
    runtime_dependencies: [],
    access_model: "local",
  }),
}))

function renderDialog(open = true) {
  const onOpenChange = vi.fn()
  render(
    <AppProvider>
      <ContextInputDialog open={open} onOpenChange={onOpenChange} />
    </AppProvider>,
  )
  return { onOpenChange }
}

describe("ContextInputDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
  })

  it("disables submit when no text blocks", async () => {
    renderDialog()
    expect(await screen.findByTestId("context-input-dialog")).toBeInTheDocument()
    expect(screen.getByTestId("context-input-submit")).toBeDisabled()
    expect(screen.getByText("请填写至少一个非空文本块")).toBeInTheDocument()
  })

  it("supports multiple text blocks and appends composed markdown", async () => {
    vi.mocked(api.appendIngestSessionMessage).mockResolvedValueOnce({
      message: {
        id: "msg-1",
        session_id: "sess-1",
        role: "user",
        content: "## Intro\n\nFirst block\n\nSecond block",
        message_type: "text",
        attachment_id: "",
        stream_status: "complete",
        created_at: "2026-01-01T00:00:00Z",
      },
    })

    const { onOpenChange } = renderDialog()
    await screen.findByTestId("context-text-block-0")

    fireEvent.change(
      within(screen.getByTestId("context-text-block-0")).getByPlaceholderText(
        "块标题（可选）",
      ),
      { target: { value: "Intro" } },
    )
    fireEvent.change(
      within(screen.getByTestId("context-text-block-0")).getByPlaceholderText(
        "正文（必填，至少一个非空文本块）",
      ),
      { target: { value: "First block" } },
    )

    fireEvent.click(screen.getByRole("button", { name: "新增文本块" }))
    const secondBlock = await screen.findByTestId("context-text-block-1")
    fireEvent.change(
      within(secondBlock).getByPlaceholderText("正文（必填，至少一个非空文本块）"),
      { target: { value: "Second block" } },
    )

    fireEvent.click(screen.getByTestId("context-input-submit"))

    await waitFor(() => {
      expect(api.appendIngestSessionMessage).toHaveBeenCalledWith(
        "sess-1",
        expect.stringContaining("First block"),
      )
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows error when append fails", async () => {
    vi.mocked(api.appendIngestSessionMessage).mockRejectedValueOnce(
      new Error("append failed"),
    )

    renderDialog()
    await screen.findByTestId("context-text-block-0")
    fireEvent.change(
      screen.getByPlaceholderText("正文（必填，至少一个非空文本块）"),
      { target: { value: "Some text" } },
    )
    fireEvent.click(screen.getByTestId("context-input-submit"))

    expect(await screen.findByTestId("context-input-error")).toHaveTextContent(
      "append failed",
    )
  })
})
