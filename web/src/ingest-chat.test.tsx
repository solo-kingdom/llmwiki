import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { IngestChat } from "@/components/IngestChat"
import { WorkbenchContentShell } from "@/components/WorkbenchContentShell"

const mockWriteText = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: (...args: unknown[]) => mockWriteText(...args),
}))

vi.mock("@/lib/api", () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
  listIngestJobs: vi.fn().mockResolvedValue([]),
  listIngestSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  listProviderInstances: vi.fn().mockResolvedValue({ instances: [] }),
  getCapabilities: vi.fn().mockResolvedValue({
    file_types: [],
    runtime_dependencies: [],
    access_model: "local",
  }),
  getSettings: vi.fn().mockResolvedValue({
    last_instance_id: "",
    last_model: "",
    max_tokens: 2048,
    api_key: "",
    temperature: 0.7,
    chunk_size: 512,
    chunk_overlap: 64,
    auto_reindex: true,
    watch_sources: false,
    job_instance_id: "",
    job_model: "",
  }),
  createIngestSession: vi.fn().mockResolvedValue({
    session: {
      id: "sess-1",
      title: "",
      status: "active",
      storage_path: "raw/sources/web-ingest/sessions/sess-1",
      llm_instance_id: "",
      llm_model: "",
      created_at: "",
      updated_at: "",
    },
  }),
  getIngestSession: vi.fn().mockResolvedValue({
    session: {
      id: "sess-1",
      title: "",
      status: "active",
      storage_path: "",
      llm_instance_id: "",
      llm_model: "",
      created_at: "",
      updated_at: "",
    },
  }),
  listIngestSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
  streamIngestSessionMessage: vi.fn().mockResolvedValue(undefined),
  uploadIngestSessionAttachment: vi.fn(),
  archiveIngestSession: vi.fn(),
  createConversationIngestJob: vi.fn(),
  createTextIngestJob: vi.fn(),
  uploadIngestJobs: vi.fn(),
  listProviders: vi.fn().mockResolvedValue([]),
  listProviderModels: vi.fn().mockResolvedValue([]),
}))

describe("IngestChat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteText.mockResolvedValue(true)
    localStorage.clear()
  })

  it("shows provider guard when no provider is configured and archive disabled", async () => {
    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )
    expect(
      await screen.findByText(/请先在 Settings 添加 Provider/),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /模型/ })).toBeInTheDocument()
    const archiveBtn = screen.getByRole("button", { name: /归档/ })
    expect(archiveBtn).toBeDisabled()
    expect(screen.getByRole("button", { name: /切换/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /新建/ })).toBeInTheDocument()
  })

  it("uses wide page container and places session controls in input action bar", async () => {
    const { container } = render(
      <AppProvider>
        <WorkbenchContentShell>
          <IngestChat />
        </WorkbenchContentShell>
      </AppProvider>,
    )
    await screen.findByRole("button", { name: /切换/ })
    expect(container.querySelector(".max-w-5xl")).toBeTruthy()
    expect(screen.getByRole("button", { name: /发送/ })).toBeInTheDocument()
  })

  it("renders message panel with border and scroll container", async () => {
    const { container } = render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )
    const panel = await screen.findByTestId("ingest-message-panel")
    expect(panel).toHaveClass("rounded-xl", "border", "overflow-hidden")
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeTruthy()
    expect(container.querySelector(".max-w-3xl")).toBeNull()
  })

  it("shows spinner while assistant is streaming with empty content", async () => {
    const api = await import("@/lib/api")
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    vi.mocked(api.listProviderInstances).mockResolvedValue({
      instances: [
        {
          id: "inst-1",
          catalog_id: "cat-1",
          name: "OpenAI",
          api_key_masked: "sk-****",
          base_url: "",
          created_at: "",
          updated_at: "",
        },
      ],
    })
    vi.mocked(api.getSettings).mockResolvedValue({
      last_instance_id: "inst-1",
      last_model: "gpt-4",
      max_tokens: 2048,
      api_key: "",
      temperature: 0.7,
      chunk_size: 512,
      chunk_overlap: 64,
      auto_reindex: true,
      watch_sources: false,
      job_instance_id: "",
      job_model: "",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-assistant",
          session_id: "sess-1",
          role: "assistant",
          content: "",
          message_type: "text",
          attachment_id: "",
          stream_status: "streaming",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    expect(await screen.findByLabelText("正在回复")).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText(/输入消息/)
    expect(textarea).not.toBeDisabled()
    fireEvent.change(textarea, { target: { value: "draft while streaming" } })
    expect(textarea).toHaveValue("draft while streaming")

    const sendBtn = screen.getByRole("button", { name: /发送/ })
    await waitFor(() => {
      expect(sendBtn).toBeDisabled()
    })
  })

  it("copies message content when copy button is clicked", async () => {
    const api = await import("@/lib/api")
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    vi.mocked(api.listProviderInstances).mockResolvedValue({
      instances: [
        {
          id: "inst-1",
          catalog_id: "cat-1",
          name: "OpenAI",
          api_key_masked: "sk-****",
          base_url: "",
          created_at: "",
          updated_at: "",
        },
      ],
    })
    vi.mocked(api.getSettings).mockResolvedValue({
      last_instance_id: "inst-1",
      last_model: "gpt-4",
      max_tokens: 2048,
      api_key: "",
      temperature: 0.7,
      chunk_size: 512,
      chunk_overlap: 64,
      auto_reindex: true,
      watch_sources: false,
      job_instance_id: "",
      job_model: "",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-user",
          session_id: "sess-1",
          role: "user",
          content: "hello copy",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    expect(await screen.findByText("hello copy")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "复制" }))
    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith("hello copy")
    })
  })

  it("shows session title on the left and provider/model on the right above input", async () => {
    const api = await import("@/lib/api")
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    vi.mocked(api.getIngestSession).mockResolvedValue({
      session: {
        id: "sess-1",
        title: "My Topic",
        status: "active",
        storage_path: "",
        llm_instance_id: "inst-1",
        llm_model: "gpt-4",
        created_at: "",
        updated_at: "",
      },
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({ messages: [] })
    vi.mocked(api.listIngestSessions).mockResolvedValue({
      sessions: [
        {
          id: "sess-1",
          title: "My Topic",
          status: "active",
          llm_instance_id: "inst-1",
          llm_model: "gpt-4",
          created_at: "",
          updated_at: "",
        },
      ],
    })
    vi.mocked(api.listProviderInstances).mockResolvedValue({
      instances: [
        {
          id: "inst-1",
          catalog_id: "cat-1",
          name: "OpenAI",
          api_key_masked: "sk-****",
          base_url: "",
          created_at: "",
          updated_at: "",
        },
      ],
    })
    vi.mocked(api.listProviderModels).mockResolvedValue([
      {
        provider_id: "cat-1",
        model_id: "gpt-4",
        name: "GPT-4",
        family: "GPT-4",
        context_limit: 128000,
        output_limit: 16384,
        cost_input: 2.5,
        cost_output: 10,
        reasoning: false,
        tool_call: true,
        attachment: true,
      },
    ])
    vi.mocked(api.getSettings).mockResolvedValue({
      last_instance_id: "inst-1",
      last_model: "gpt-4",
      max_tokens: 2048,
      api_key: "",
      temperature: 0.7,
      chunk_size: 512,
      chunk_overlap: 64,
      auto_reindex: true,
      watch_sources: false,
      job_instance_id: "",
      job_model: "",
    })

    const { container } = render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    expect(await screen.findByText("My Topic")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument()
      expect(screen.getByText("GPT-4")).toBeInTheDocument()
    })

    const infoRow = container.querySelector(
      ".mb-1.flex.items-center.justify-between",
    )
    expect(infoRow).toBeTruthy()
    const children = infoRow!.children
    expect(children[0]).toHaveTextContent("My Topic")
    expect(children[1]).toHaveTextContent("OpenAI")
    expect(children[1]).toHaveTextContent("GPT-4")
  })

  it("shows failed assistant error when content is empty", async () => {
    const api = await import("@/lib/api")
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    vi.mocked(api.listProviderInstances).mockResolvedValue({
      instances: [
        {
          id: "inst-1",
          catalog_id: "cat-1",
          name: "OpenAI",
          api_key_masked: "sk-****",
          base_url: "",
          created_at: "",
          updated_at: "",
        },
      ],
    })
    vi.mocked(api.getSettings).mockResolvedValue({
      last_instance_id: "inst-1",
      last_model: "gpt-4",
      max_tokens: 2048,
      api_key: "",
      temperature: 0.7,
      chunk_size: 512,
      chunk_overlap: 64,
      auto_reindex: true,
      watch_sources: false,
      job_instance_id: "",
      job_model: "",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-user",
          session_id: "sess-1",
          role: "user",
          content: "trigger fail",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "msg-assistant",
          session_id: "sess-1",
          role: "assistant",
          content: "",
          message_type: "text",
          attachment_id: "",
          stream_status: "failed",
          created_at: "2026-01-01T00:00:01Z",
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    expect(await screen.findByText("回复失败")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新发送" })).toBeInTheDocument()
  })

  it("shows archive success as toast that auto-dismisses after 3 seconds", async () => {
    const api = await import("@/lib/api")
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    vi.mocked(api.listProviderInstances).mockResolvedValue({
      instances: [
        {
          id: "inst-1",
          catalog_id: "cat-1",
          name: "OpenAI",
          api_key_masked: "sk-****",
          base_url: "",
          created_at: "",
          updated_at: "",
        },
      ],
    })
    vi.mocked(api.getSettings).mockResolvedValue({
      last_instance_id: "inst-1",
      last_model: "gpt-4",
      max_tokens: 2048,
      api_key: "",
      temperature: 0.7,
      chunk_size: 512,
      chunk_overlap: 64,
      auto_reindex: true,
      watch_sources: false,
      job_instance_id: "",
      job_model: "",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-user",
          session_id: "sess-1",
          role: "user",
          content: "archive me",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    })
    vi.mocked(api.archiveIngestSession).mockResolvedValue({
      job_id: "job-abc123",
      source_path: "raw/sources/web-ingest/sessions/sess-1",
      session_id: "sess-1",
    })
    vi.mocked(api.listIngestSessions).mockResolvedValue({
      sessions: [
        {
          id: "sess-1",
          title: "",
          status: "active",
          llm_instance_id: "inst-1",
          llm_model: "gpt-4",
          created_at: "",
          updated_at: "",
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    await screen.findByText("archive me")
    fireEvent.click(screen.getByRole("button", { name: /归档/ }))
    fireEvent.click(screen.getByRole("button", { name: /确认归档/ }))

    expect(
      await screen.findByText("已提交归档任务：job-abc123"),
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toBeInTheDocument()
  })

  it("shows archive failure as top toast", async () => {
    const api = await import("@/lib/api")
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    vi.mocked(api.listProviderInstances).mockResolvedValue({
      instances: [
        {
          id: "inst-1",
          catalog_id: "cat-1",
          name: "OpenAI",
          api_key_masked: "sk-****",
          base_url: "",
          created_at: "",
          updated_at: "",
        },
      ],
    })
    vi.mocked(api.getSettings).mockResolvedValue({
      last_instance_id: "inst-1",
      last_model: "gpt-4",
      max_tokens: 2048,
      api_key: "",
      temperature: 0.7,
      chunk_size: 512,
      chunk_overlap: 64,
      auto_reindex: true,
      watch_sources: false,
      job_instance_id: "",
      job_model: "",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-user",
          session_id: "sess-1",
          role: "user",
          content: "archive me",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    })
    vi.mocked(api.archiveIngestSession).mockRejectedValue(
      new Error("create ingest job: database is locked (5) (SQLITE_BUSY)"),
    )
    vi.mocked(api.listIngestSessions).mockResolvedValue({
      sessions: [
        {
          id: "sess-1",
          title: "",
          status: "active",
          llm_instance_id: "inst-1",
          llm_model: "gpt-4",
          created_at: "",
          updated_at: "",
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    await screen.findByText("archive me")
    fireEvent.click(screen.getByRole("button", { name: /归档/ }))
    fireEvent.click(screen.getByRole("button", { name: /确认归档/ }))

    expect(
      await screen.findByText(
        "create ingest job: database is locked (5) (SQLITE_BUSY)",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toBeInTheDocument()
  })
})
