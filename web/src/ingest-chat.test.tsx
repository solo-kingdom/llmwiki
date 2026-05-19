import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { IngestChat } from "@/components/IngestChat"
vi.mock("@/lib/api", () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
  listIngestJobs: vi.fn().mockResolvedValue([]),
  getCapabilities: vi.fn().mockResolvedValue({
    file_types: [],
    runtime_dependencies: [],
    access_model: "local",
  }),
  getSettings: vi.fn().mockResolvedValue({
    last_provider: "",
    last_model: "",
    max_tokens: 2048,
    api_key: "",
    temperature: 0.7,
    chunk_size: 512,
    chunk_overlap: 64,
    auto_reindex: true,
    watch_sources: false,
    provider_keys: {},
  }),
  createIngestSession: vi.fn().mockResolvedValue({
    session: {
      id: "sess-1",
      title: "",
      status: "active",
      storage_path: "raw/sources/web-ingest/sessions/sess-1",
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
  loadProviders: vi.fn().mockResolvedValue([]),
}))

describe("IngestChat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it("shows provider guard when no provider is selected and archive disabled", async () => {
    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )
    // With no provider configured, the guard message is shown
    expect(await screen.findByText(/Select a provider to begin/)).toBeInTheDocument()
    const archiveBtn = screen.getByRole("button", { name: /归档/ })
    expect(archiveBtn).toBeDisabled()
  })
})
