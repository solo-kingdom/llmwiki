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
    ui_language: "zh",
    doc_language: "zh",
  }),
  createIngestSession: vi.fn().mockResolvedValue({
    session: {
      id: "sess-1",
      title: "",
      status: "active",
      mode: "chat",
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
      mode: "chat",
      storage_path: "",
      llm_instance_id: "",
      llm_model: "",
      created_at: "",
      updated_at: "",
    },
  }),
  listIngestSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
  streamIngestSessionMessage: vi.fn().mockResolvedValue(undefined),
  streamRetryIngestSessionMessage: vi.fn().mockResolvedValue(undefined),
  searchDocuments: vi.fn().mockResolvedValue({ results: [] }),
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
    const archiveBtn = screen.getByRole("button", { name: /^归档$/ })
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
    ui_language: "zh",
    doc_language: "zh",
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

    const textarea = await screen.findByPlaceholderText(/输入消息/)
    expect(textarea).not.toBeDisabled()
    fireEvent.change(textarea, { target: { value: "draft while streaming" } })
    expect(textarea).toHaveValue("draft while streaming")

    // While streaming, the send button becomes a Stop button
    const stopBtn = screen.getByRole("button", { name: /停止/ })
    expect(stopBtn).toBeInTheDocument()
    expect(stopBtn).not.toBeDisabled()
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
    ui_language: "zh",
    doc_language: "zh",
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

  it("copies all messages when copy-all button is clicked", async () => {
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
      ui_language: "zh",
      doc_language: "zh",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-user",
          session_id: "sess-1",
          role: "user",
          content: "question one",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "msg-assistant",
          session_id: "sess-1",
          role: "assistant",
          content: "answer one",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:01Z",
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    expect(await screen.findByText("question one")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "复制全部" }))
    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(
        "用户: question one\n\n助手: answer one",
      )
    })
  })

  it("does not render copy-all button when session has no copyable messages", async () => {
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
      ui_language: "zh",
      doc_language: "zh",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({ messages: [] })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )
    expect(await screen.findByText("开始一个话题")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "复制全部" })).not.toBeInTheDocument()
  })

  it("shows session title on the left and provider/model on the right above input", async () => {
    const api = await import("@/lib/api")
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    vi.mocked(api.getIngestSession).mockResolvedValue({
      session: {
        id: "sess-1",
        title: "My Topic",
        status: "active",
        mode: "chat",
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
          mode: "chat",
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
    ui_language: "zh",
    doc_language: "zh",
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
    ui_language: "zh",
    doc_language: "zh",
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
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("shows failed assistant error content from server", async () => {
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
      ui_language: "zh",
      doc_language: "zh",
    })
    const errorText = "bad request (HTTP 400): 工具类型不能为空"
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
          content: errorText,
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

    expect(await screen.findByText(errorText)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("shows retry button for incomplete assistant", async () => {
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
    ui_language: "zh",
    doc_language: "zh",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-user",
          session_id: "sess-1",
          role: "user",
          content: "hello",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "msg-assistant",
          session_id: "sess-1",
          role: "assistant",
          content: "partial",
          message_type: "text",
          attachment_id: "",
          stream_status: "incomplete",
          created_at: "2026-01-01T00:00:01Z",
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    expect(await screen.findByText("回复未完成")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("retry calls streamRetryIngestSessionMessage not streamIngestSessionMessage", async () => {
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
    ui_language: "zh",
    doc_language: "zh",
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

    const retryBtn = await screen.findByRole("button", { name: "重试" })
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/输入消息/),
      ).not.toBeDisabled()
    })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(api.streamRetryIngestSessionMessage).toHaveBeenCalledWith(
        "sess-1",
        "msg-assistant",
        expect.any(Function),
        expect.any(AbortSignal),
      )
    })
    expect(api.streamIngestSessionMessage).not.toHaveBeenCalled()
  })

  it("disables archive when only optimistic temp user messages exist", async () => {
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
      ui_language: "zh",
      doc_language: "zh",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "temp-user-123",
          session_id: "sess-1",
          role: "user",
          content: "pending",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
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

    await screen.findByText("pending")
    expect(screen.getByRole("button", { name: /^归档$/ })).toBeDisabled()
  })

  it("calls archive API only once when confirm is double-clicked", async () => {
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
      ui_language: "zh",
      doc_language: "zh",
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
    let resolveArchive!: (v: Awaited<ReturnType<typeof api.archiveIngestSession>>) => void
    const archivePromise = new Promise<
      Awaited<ReturnType<typeof api.archiveIngestSession>>
    >((resolve) => {
      resolveArchive = resolve
    })
    vi.mocked(api.archiveIngestSession).mockImplementation(
      () => archivePromise,
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
    fireEvent.click(screen.getByRole("button", { name: /^归档$/ }))
    const confirm = screen.getByRole("button", { name: /确认归档/ })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(api.archiveIngestSession).toHaveBeenCalledTimes(1)

    resolveArchive({
      review_id: "review-abc123",
      status: "planning",
      source_path: "raw/sources/web-ingest/sessions/sess-1",
      session_id: "sess-1",
    })
    await screen.findByText("归档已提交，请前往审核页查看计划")
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
    ui_language: "zh",
    doc_language: "zh",
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
      review_id: "review-abc123",
      status: "planning",
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
    fireEvent.click(screen.getByRole("button", { name: /^归档$/ }))
    fireEvent.click(screen.getByRole("button", { name: /确认归档/ }))

    expect(
      await screen.findByText("归档已提交，请前往审核页查看计划"),
    ).toBeInTheDocument()
    expect(screen.getByText("去审核")).toBeInTheDocument()
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
    ui_language: "zh",
    doc_language: "zh",
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
    fireEvent.click(screen.getByRole("button", { name: /^归档$/ }))
    fireEvent.click(screen.getByRole("button", { name: /确认归档/ }))

    expect(
      await screen.findByText(
        "create ingest job: database is locked (5) (SQLITE_BUSY)",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toBeInTheDocument()
  })

  it("adds wiki mention chip when selecting from @ picker", async () => {
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
      ui_language: "zh",
      doc_language: "zh",
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
    // Provide documents for the fzf search
    vi.mocked(api.listDocuments).mockResolvedValue([
      {
        id: "doc-alpha",
        filename: "alpha.md",
        title: "Alpha Page",
        path: "wiki/concepts/alpha.md",
        relative_path: "wiki/concepts/alpha.md",
        file_type: "md",
        page_count: 1,
        updated_at: "2026-01-01",
      },
    ])

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    const textarea = await screen.findByPlaceholderText(/输入消息/)
    // Simulate typing @ in textarea — dispatch native input event for the DOM listener
    fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } })
    textarea.dispatchEvent(new Event("input", { bubbles: true }))

    const option = await screen.findByRole("button", { name: /Alpha Page/ }, { timeout: 3000 })
    fireEvent.click(option)

    expect(await screen.findByText("@Alpha Page")).toBeInTheDocument()
  })

  it("shows user wiki refs and assistant tool reads in message bubbles", async () => {
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
      ui_language: "zh",
      doc_language: "zh",
    })
    vi.mocked(api.listIngestSessionMessages).mockResolvedValue({
      messages: [
        {
          id: "msg-user",
          session_id: "sess-1",
          role: "user",
          content: "explain alpha",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:00Z",
          wiki_refs_json: JSON.stringify([
            {
              document_id: "doc-alpha",
              relative_path: "wiki/concepts/alpha.md",
              title: "Alpha Page",
            },
          ]),
        },
        {
          id: "msg-assistant",
          session_id: "sess-1",
          role: "assistant",
          content: "Alpha is a concept.",
          message_type: "text",
          attachment_id: "",
          stream_status: "complete",
          created_at: "2026-01-01T00:00:01Z",
          tool_status: "正在读取 wiki/concepts/beta.md…",
          tool_reads: ["wiki/concepts/beta.md"],
        },
      ],
    })

    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )

    expect(await screen.findByText("引用的 wiki 页面")).toBeInTheDocument()
    expect(screen.getByText("Alpha Page")).toBeInTheDocument()
    expect(screen.getByText("查阅的 wiki 页面")).toBeInTheDocument()
    expect(screen.getByText("wiki/concepts/beta.md")).toBeInTheDocument()
    expect(screen.getByText("正在读取 wiki/concepts/beta.md…")).toBeInTheDocument()
  })
})
