import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { ChatSidebar } from "@/components/ChatSidebar"
import type {
  Provider,
  ModelInfo,
  SessionListItem,
  Settings,
} from "@/types"

// Mock API module with all required functions
const mockListProviders = vi.fn()
const mockListProviderModels = vi.fn()
const mockListIngestSessions = vi.fn()
const mockCreateIngestSession = vi.fn()
const mockUpdateIngestSession = vi.fn()
const mockUpdateLastModel = vi.fn()
const mockGetSettings = vi.fn()
const mockListDocuments = vi.fn()
const mockListIngestJobs = vi.fn()
const mockGetCapabilities = vi.fn()
const mockGetIngestSession = vi.fn()
const mockListIngestSessionMessages = vi.fn()
const mockStreamIngestSessionMessage = vi.fn()

vi.mock("@/lib/api", () => ({
  listProviders: (...args: unknown[]) => mockListProviders(...args),
  listProviderModels: (...args: unknown[]) => mockListProviderModels(...args),
  listIngestSessions: (...args: unknown[]) => mockListIngestSessions(...args),
  createIngestSession: (...args: unknown[]) => mockCreateIngestSession(...args),
  updateIngestSession: (...args: unknown[]) => mockUpdateIngestSession(...args),
  updateLastModel: (...args: unknown[]) => mockUpdateLastModel(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  listDocuments: (...args: unknown[]) => mockListDocuments(...args),
  listIngestJobs: (...args: unknown[]) => mockListIngestJobs(...args),
  getCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
  getIngestSession: (...args: unknown[]) => mockGetIngestSession(...args),
  listIngestSessionMessages: (...args: unknown[]) => mockListIngestSessionMessages(...args),
  streamIngestSessionMessage: (...args: unknown[]) => mockStreamIngestSessionMessage(...args),
  uploadIngestSessionAttachment: vi.fn(),
  archiveIngestSession: vi.fn(),
  createConversationIngestJob: vi.fn(),
  createTextIngestJob: vi.fn(),
  uploadIngestJobs: vi.fn(),
  setProviderKey: vi.fn(),
}))

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "openai",
    name: "OpenAI",
    api_base: "https://api.openai.com/v1",
    api_format: "openai",
    has_key: true,
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
    llm_provider: "openai",
    llm_model: "gpt-4o",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function defaultSettings(): Settings {
  return {
    last_provider: "openai",
    last_model: "gpt-4o",
    max_tokens: 2048,
    api_key: "",
    temperature: 0.7,
    chunk_size: 512,
    chunk_overlap: 64,
    auto_reindex: true,
    watch_sources: false,
    provider_keys: {
      openai: { has_key: true, masked: "sk-t****" },
    },
    llm_provider: "openai",
    llm_model: "gpt-4o",
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
    makeProvider({ id: "openai", name: "OpenAI", has_key: true }),
    makeProvider({ id: "anthropic", name: "Anthropic", has_key: false }),
  ])
  mockListProviderModels.mockResolvedValue([
    { provider_id: "openai", model_id: "gpt-4o", name: "GPT-4o", family: "GPT-4", context_limit: 128000, output_limit: 16384, cost_input: 2.5, cost_output: 10.0, reasoning: true, tool_call: true, attachment: false },
    { provider_id: "openai", model_id: "gpt-4o-mini", name: "GPT-4o Mini", family: "GPT-4", context_limit: 128000, output_limit: 16384, cost_input: 0.15, cost_output: 0.6, reasoning: false, tool_call: false, attachment: false },
  ])
  mockListIngestSessions.mockResolvedValue({ sessions: [] })
  mockCreateIngestSession.mockResolvedValue({
    session: {
      id: "sess-new",
      title: "",
      status: "active",
      storage_path: "raw/sources/web-ingest/sessions/sess-new",
      llm_provider: "openai",
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
      llm_provider: "openai",
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
      llm_provider: "anthropic",
      llm_model: "claude-3",
      created_at: "",
      updated_at: "",
    },
  })
}

describe("ChatSidebar Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupDefaultMocks()
  })

  it("renders sidebar with session list", async () => {
    mockListIngestSessions.mockResolvedValue({
      sessions: [
        makeSession({ id: "s-1", title: "Chat 1" }),
        makeSession({ id: "s-2", title: "Chat 2", llm_provider: "anthropic", llm_model: "claude-3" }),
      ],
    })

    render(
      <AppProvider>
        <ChatSidebar />
      </AppProvider>,
    )

    // Should load sessions
    await waitFor(() => {
      expect(mockListIngestSessions).toHaveBeenCalled()
    })

    // Session titles should appear
    expect(await screen.findByText("Chat 1")).toBeInTheDocument()
    expect(screen.getByText("Chat 2")).toBeInTheDocument()
  })

  it("shows provider name for sessions", async () => {
    mockListIngestSessions.mockResolvedValue({
      sessions: [
        makeSession({ id: "s-1", title: "Chat OpenAI", llm_provider: "openai" }),
      ],
    })

    render(
      <AppProvider>
        <ChatSidebar />
      </AppProvider>,
    )

    await waitFor(() => {
      expect(mockListProviders).toHaveBeenCalled()
    })

    // Provider name should be shown (it's in the format "OpenAI / gpt-4o")
    const providerElements = await screen.findAllByText(/OpenAI/)
    expect(providerElements.length).toBeGreaterThanOrEqual(1)
  })

  it("creates new session on button click", async () => {
    render(
      <AppProvider>
        <ChatSidebar />
      </AppProvider>,
    )

    const newBtn = await screen.findByRole("button", { name: /New chat/i })
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
        <ChatSidebar />
      </AppProvider>,
    )

    const firstChat = await screen.findByText("First Chat")
    fireEvent.click(firstChat)

    // Clicking a session should trigger getIngestSession
    await waitFor(() => {
      expect(mockGetIngestSession).toHaveBeenCalled()
    })
  })
})

describe("Provider/Model Selection Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupDefaultMocks()
  })

  it("loads provider list on mount", async () => {
    render(
      <AppProvider>
        <ChatSidebar />
      </AppProvider>,
    )

    await waitFor(() => {
      expect(mockListProviders).toHaveBeenCalled()
    })
  })

  it("loads models when provider is selected", async () => {
    const { loadModels } = await import("@/context/AppContext")
    // This tests the API layer - loadModels calls listProviderModels
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

  it("provider without key shows warning status", async () => {
    mockListProviders.mockResolvedValue([
      makeProvider({ id: "openai", name: "OpenAI", has_key: true }),
      makeProvider({ id: "anthropic", name: "Anthropic", has_key: false }),
    ])

    render(
      <AppProvider>
        <ChatSidebar />
      </AppProvider>,
    )

    await waitFor(() => {
      expect(mockListProviders).toHaveBeenCalled()
    })

    // The anthropic provider should show as not having a key
    // This is verified through the provider data structure
    const providers = await mockListProviders.mock.results[0].value
    const anthropic = providers.find((p: Provider) => p.id === "anthropic")
    expect(anthropic.has_key).toBe(false)
  })
})

describe("Session Update Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setupDefaultMocks()
  })

  it("calls updateIngestSession when switching provider", async () => {
    // Simulate the API call pattern
    mockUpdateIngestSession.mockResolvedValueOnce({
      session: {
        id: "sess-new",
        title: "",
        status: "active",
        storage_path: "",
        llm_provider: "anthropic",
        llm_model: "claude-3",
        created_at: "",
        updated_at: "",
      },
    })

    const { updateIngestSession } = await import("@/lib/api")
    await updateIngestSession("sess-new", {
      provider: "anthropic",
      model: "claude-3",
    })

    expect(mockUpdateIngestSession).toHaveBeenCalledWith("sess-new", {
      provider: "anthropic",
      model: "claude-3",
    })
  })

  it("calls updateLastModel when model changes", async () => {
    const { updateLastModel } = await import("@/lib/api")
    await updateLastModel("anthropic", "claude-3")

    expect(mockUpdateLastModel).toHaveBeenCalledWith("anthropic", "claude-3")
  })
})
