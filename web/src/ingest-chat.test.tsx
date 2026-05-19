import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { IngestChat } from "@/components/IngestChat"
import * as api from "@/lib/api"

vi.mock("@/lib/api", () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
  listIngestJobs: vi.fn().mockResolvedValue([]),
  getCapabilities: vi.fn().mockResolvedValue({
    file_types: [],
    runtime_dependencies: [],
    access_model: "local",
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
}))

describe("IngestChat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it("shows empty state and archive disabled without user messages", async () => {
    render(
      <AppProvider>
        <IngestChat />
      </AppProvider>,
    )
    expect(await screen.findByText(/开始一个话题/)).toBeInTheDocument()
    const archiveBtn = screen.getByRole("button", { name: /归档/ })
    expect(archiveBtn).toBeDisabled()
  })
})
