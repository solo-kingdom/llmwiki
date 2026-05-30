import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import App from "@/App"

vi.mock("@/lib/api", () => ({
  getPublicWikiStatus: vi.fn().mockResolvedValue({ enabled: false }),
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
      storage_path: "",
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
  streamIngestSessionMessage: vi.fn(),
  uploadIngestSessionAttachment: vi.fn(),
  archiveIngestSession: vi.fn(),
  createConversationIngestJob: vi.fn(),
  createTextIngestJob: vi.fn(),
  uploadIngestJobs: vi.fn(),
  listProviders: vi.fn().mockResolvedValue([]),
  getIngestReview: vi.fn().mockResolvedValue({
    id: "review-1",
    session_id: "sess-1",
    archive_source_path: "raw/test.md",
    status: "planning",
    current_plan_version: 0,
    approved_plan_version: 0,
    created_at: "",
    updated_at: "",
  }),
  listIngestReviewPlans: vi.fn().mockResolvedValue([]),
  getWorkspaceRuleFiles: vi.fn().mockResolvedValue({
    purpose_preview: "",
    rules_preview: "",
  }),
  getVCStatus: vi.fn().mockResolvedValue({
    enabled: false,
    commit_count: 0,
    git_available: false,
    git_version: "",
    tracked_dirs: [],
    excluded_dirs: [],
  }),
  getVCLog: vi.fn().mockResolvedValue([]),
  listActivityLogs: vi.fn().mockResolvedValue({
    logs: [],
    total: 0,
    limit: 50,
    offset: 0,
    has_more: false,
  }),
  clearActivityLogs: vi.fn().mockResolvedValue({ deleted_count: 0 }),
}))

describe("Workbench layout shell", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    window.history.replaceState(null, "", "/")
  })

  it("uses centered workbench content column for header and page content", async () => {
    render(<App />)
    await screen.findByRole("navigation")

    const shell = document.querySelector(".max-w-5xl")
    expect(shell).toBeTruthy()
    expect(shell?.className).toContain("px-6")
    expect(shell?.querySelector("header")).toBeTruthy()
  })
})
