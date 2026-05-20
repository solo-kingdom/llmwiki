import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { IngestChat } from "@/components/IngestChat"

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
}))

describe("IngestChat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        <IngestChat />
      </AppProvider>,
    )
    await screen.findByRole("button", { name: /切换/ })
    expect(container.querySelector(".max-w-5xl")).toBeTruthy()
    expect(screen.getByRole("button", { name: /发送/ })).toBeInTheDocument()
  })
})
