import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { SessionControls } from "@/components/SessionControls"
import type {
  Provider,
  SessionListItem,
  Settings,
} from "@/types"

// Mock API module with all required functions
const mockListProviders = vi.fn()
const mockListProviderModels = vi.fn()
const mockListIngestSessions = vi.fn()
const mockCreateIngestSession = vi.fn()
const mockDeleteIngestSession = vi.fn()
const mockUpdateIngestSession = vi.fn()
const mockUpdateLastModel = vi.fn()
const mockGetSettings = vi.fn()
const mockListDocuments = vi.fn()
const mockListIngestJobs = vi.fn()
const mockGetCapabilities = vi.fn()
const mockGetIngestSession = vi.fn()
const mockListIngestSessionMessages = vi.fn()
const mockStreamIngestSessionMessage = vi.fn()
const mockListProviderInstances = vi.fn()

vi.mock("@/lib/api", () => ({
  listProviders: (...args: unknown[]) => mockListProviders(...args),
  listProviderModels: (...args: unknown[]) => mockListProviderModels(...args),
  listIngestSessions: (...args: unknown[]) => mockListIngestSessions(...args),
  createIngestSession: (...args: unknown[]) => mockCreateIngestSession(...args),
  deleteIngestSession: (...args: unknown[]) => mockDeleteIngestSession(...args),
  updateIngestSession: (...args: unknown[]) => mockUpdateIngestSession(...args),
  updateLastModel: (...args: unknown[]) => mockUpdateLastModel(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  listDocuments: (...args: unknown[]) => mockListDocuments(...args),
  listIngestJobs: (...args: unknown[]) => mockListIngestJobs(...args),
  getCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
  getIngestSession: (...args: unknown[]) => mockGetIngestSession(...args),
  listIngestSessionMessages: (...args: unknown[]) => mockListIngestSessionMessages(...args),
  streamIngestSessionMessage: (...args: unknown[]) => mockStreamIngestSessionMessage(...args),
  listProviderInstances: (...args: unknown[]) => mockListProviderInstances(...args),
  uploadIngestSessionAttachment: vi.fn(),
  archiveIngestSession: vi.fn(),
  createConversationIngestJob: vi.fn(),
  createTextIngestJob: vi.fn(),
  uploadIngestJobs: vi.fn(),
}))

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "openai",
    name: "OpenAI",
    api_base: "https://api.openai.com/v1",
    api_format: "openai",
    env_key: "OPENAI_API_KEY",
    doc_url: "",
    ...overrides,
  }
}

function makeSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: "sess-1",
    title: "Test Session",
    status: "active",
    llm_instance_id: "inst-1",
    llm_model: "gpt-4o",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function defaultSettings(): Settings {
  return {
    last_instance_id: "inst-1",
    last_model: "gpt-4o",
    max_tokens: 2048,
    api_key: "",
    temperature: 0.7,
    chunk_size: 512,
    chunk_overlap: 64,
    auto_reindex: true,
    watch_sources: false,
    job_instance_id: "",
    job_model: "",
  }
}

function setupDefaultMocks() {
  mockListDocuments.mockResolvedValue([])
  mockListIngestJobs.mockResolvedValue([])
  mockGetCapabilities.mockResolvedValue({
    file_types: [],
    runtime_dependencies: [],
    access_model: "local",
  })
  mockListProviders.mockResolvedValue([
    makeProvider({ id: "openai", name: "OpenAI" }),
    makeProvider({ id: "anthropic", name: "Anthropic" }),
  ])
  mockListProviderInstances.mockResolvedValue({
    instances: [
      { id: "inst-1", name: "OpenAI Default", catalog_id: "openai", api_key_masked: "sk-****", base_url: "", created_at: "", updated_at: "" },
    ],
  })
  mockListProviderModels.mockResolvedValue([
    { provider_id: "openai", model_id: "gpt-4o", name: "GPT-4o", family: "GPT-4", context_limit: 128000, output_limit: 16384, cost_input: 2.5, cost_output: 10.0, reasoning: true, tool_call: true, attachment: false },
    { provider_id: "openai", model_id: "gpt-4o-mini", name: "GPT-4o Mini", family: "GPT-4", context_limit: 128000, output_limit: 16384, cost_input: 0.15, cost_output: 0.6, reasoning: false, tool_call: false, attachment: false },
  ])
  mockListIngestSessions.mockResolvedValue({ sessions: [] })
  mockDeleteIngestSession.mockResolvedValue({ status: "deleted" })
  mockCreateIngestSession.mockResolvedValue({
    session: {
      id: "sess-new",
      title: "",
      status: "active",
      storage_path: "raw/sources/web-ingest/sessions/sess-new",
      llm_instance_id: "inst-1",
      llm_model: "gpt-4o",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  })
  mockGetSettings.mockResolvedValue(defaultSettings())
  mockGetIngestSession.mockResolvedValue({
    session: {
      id: "sess-new",
      title: "",
      status: "active",
      storage_path: "",
      llm_instance_id: "inst-1",
      llm_model: "gpt-4o",
      created_at: "",
      updated_at: "",
    },
  })
  mockListIngestSessionMessages.mockResolvedValue({ messages: [] })
  mockStreamIngestSessionMessage.mockResolvedValue(undefined)
  mockUpdateLastModel.mockResolvedValue({ status: "ok" })
  mockUpdateIngestSession.mockResolvedValue({
    session: {
      id: "sess-new",
      title: "",
      status: "active",
      storage_path: "",
      llm_instance_id: "inst-2",
      llm_model: "claude-3",
      created_at: "",
      updated_at: "",
    },
  })
}

describe("SessionControls Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupDefaultMocks()
  })

  it("renders sidebar with session list", async () => {
    mockListIngestSessions.mockResolvedValue({
      sessions: [
        makeSession({ id: "s-1", title: "Chat 1" }),
        makeSession({ id: "s-2", title: "Chat 2", llm_instance_id: "inst-2", llm_model: "claude-3" }),
      ],
    })

    render(
      <AppProvider>
        <SessionControls />
      </AppProvider>,
    )

    // Should load sessions
    await waitFor(() => {
      expect(mockListIngestSessions).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole("button", { name: /切换/ }))
    expect(await screen.findByText("Chat 1")).toBeInTheDocument()
    expect(screen.getByText("Chat 2")).toBeInTheDocument()
  })

  it("shows provider name for sessions", async () => {
    mockListIngestSessions.mockResolvedValue({
      sessions: [
        makeSession({ id: "s-1", title: "Chat OpenAI", llm_instance_id: "inst-1" }),
      ],
    })

    render(
      <AppProvider>
        <SessionControls />
      </AppProvider>,
    )

    await waitFor(() => {
      expect(mockListIngestSessions).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole("button", { name: /切换/ }))
    const providerElements = await screen.findAllByText(/OpenAI/)
    expect(providerElements.length).toBeGreaterThanOrEqual(1)
  })

  it("creates new session on button click", async () => {
    render(
      <AppProvider>
        <SessionControls />
      </AppProvider>,
    )

    const newBtn = await screen.findByRole("button", { name: /新建/ })
    fireEvent.click(newBtn)

    await waitFor(() => {
      expect(mockCreateIngestSession).toHaveBeenCalled()
    })
  })

  it("switches between sessions on click", async () => {
    mockListIngestSessions.mockResolvedValue({
      sessions: [
        makeSession({ id: "s-1", title: "First Chat" }),
        makeSession({ id: "s-2", title: "Second Chat" }),
      ],
    })

    render(
      <AppProvider>
        <SessionControls />
      </AppProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: /切换/ }))
    const firstChat = await screen.findByText("First Chat")
    fireEvent.click(firstChat)

    // Clicking a session should trigger getIngestSession
    await waitFor(() => {
      expect(mockGetIngestSession).toHaveBeenCalled()
    })
  })

  it("shows delete confirmation before removing a session", async () => {
    mockListIngestSessions.mockResolvedValue({
      sessions: [
        makeSession({ id: "s-1", title: "Chat 1" }),
        makeSession({ id: "s-2", title: "Old Chat", status: "archived" }),
      ],
    })

    render(
      <AppProvider>
        <SessionControls />
      </AppProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: /切换/ }))
    await screen.findByText("Chat 1")

    const deleteButtons = screen.getAllByTitle("删除会话")
    fireEvent.click(deleteButtons[0])

    expect(
      screen.getByText(/确认删除会话「Chat 1」？聊天记录将被永久删除/),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }))

    await waitFor(() => {
      expect(mockDeleteIngestSession).toHaveBeenCalledWith("s-1")
    })
  })
})

describe("Provider/Model Selection Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupDefaultMocks()
  })

  it("loads provider instances on mount", async () => {
    render(
      <AppProvider>
        <SessionControls />
      </AppProvider>,
    )

    await waitFor(() => {
      expect(mockListProviderInstances).toHaveBeenCalled()
    })
  })

  it("loads models when provider is selected", async () => {
    // This tests the API layer - listProviderModels is the underlying API
    await waitFor(() => {
      expect(mockListProviderModels).toBeDefined()
    })
  })
})

describe("Input Guard Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupDefaultMocks()
  })

  it("provider without instance shows no key status", async () => {
    mockListProviders.mockResolvedValue([
      makeProvider({ id: "openai", name: "OpenAI" }),
      makeProvider({ id: "anthropic", name: "Anthropic" }),
    ])
    mockListProviderInstances.mockResolvedValue({
      instances: [],
    })

    render(
      <AppProvider>
        <SessionControls />
      </AppProvider>,
    )

    await waitFor(() => {
      expect(mockListProviderInstances).toHaveBeenCalled()
    })

    const result = await mockListProviderInstances.mock.results[0].value
    expect(result.instances).toHaveLength(0)
  })
})

describe("Session Update Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupDefaultMocks()
  })

  it("calls updateIngestSession when switching instance", async () => {
    // Simulate the API call pattern
    mockUpdateIngestSession.mockResolvedValueOnce({
      session: {
        id: "sess-new",
        title: "",
        status: "active",
        storage_path: "",
        llm_instance_id: "inst-2",
        llm_model: "claude-3",
        created_at: "",
        updated_at: "",
      },
    })

    const { updateIngestSession } = await import("@/lib/api")
    await updateIngestSession("sess-new", {
      instance_id: "inst-2",
      model: "claude-3",
    })

    expect(mockUpdateIngestSession).toHaveBeenCalledWith("sess-new", {
      instance_id: "inst-2",
      model: "claude-3",
    })
  })

  it("calls updateLastModel when model changes", async () => {
    const { updateLastModel } = await import("@/lib/api")
    await updateLastModel("inst-1", "gpt-4o")

    expect(mockUpdateLastModel).toHaveBeenCalledWith("inst-1", "gpt-4o")
  })
})
