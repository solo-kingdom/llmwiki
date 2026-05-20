import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import App from "@/App"
import * as api from "@/lib/api"
import type { VCStatus } from "@/types"

function mockVCStatus(enabled: boolean): VCStatus {
  return {
    enabled,
    commit_count: enabled ? 1 : 0,
    git_available: enabled,
    git_version: enabled ? "2.43.0" : "",
    tracked_dirs: enabled ? ["wiki"] : [],
    excluded_dirs: [],
  }
}

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
  }),
  createIngestSession: vi.fn().mockResolvedValue({
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
  streamIngestSessionMessage: vi.fn(),
  uploadIngestSessionAttachment: vi.fn(),
  archiveIngestSession: vi.fn(),
  createConversationIngestJob: vi.fn(),
  createTextIngestJob: vi.fn(),
  uploadIngestJobs: vi.fn(),
  listProviders: vi.fn().mockResolvedValue([]),
  getVCStatus: vi.fn().mockResolvedValue(mockVCStatus(false)),
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

describe("App navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    window.history.replaceState(null, "", "/")
  })

  it("defaults to chat and uses button navigation", async () => {
    render(<App />)
    expect(await screen.findByRole("button", { name: "Chat" })).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Ingest" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "模型" })).toBeInTheDocument()
    expect(window.location.pathname).toBe("/")

    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByTestId("ingest-raw-page")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/ingest")

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "Settings",
      }),
    )
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe("/settings")

    fireEvent.click(screen.getByRole("button", { name: "Jobs" }))
    expect(await screen.findByText("暂无摄入任务")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/jobs")

    fireEvent.click(screen.getByRole("button", { name: "Logs" }))
    expect(await screen.findByText("暂无系统日志")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/logs")

    const wikiLink = screen.getByRole("link", { name: "Wiki" })
    expect(wikiLink).toHaveAttribute("href", "/wiki")
  })

  it("navigates to wiki reader shell when Wiki link is clicked", async () => {
    window.history.replaceState(null, "", "/")
    render(<App />)
    await screen.findByRole("button", { name: "Chat" })

    fireEvent.click(screen.getByRole("link", { name: "Wiki" }))
    expect(window.location.pathname).toBe("/wiki")
    expect(await screen.findByText("管理工作台")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "模型" })).not.toBeInTheDocument()
  })

  it("restores settings view from URL on load", async () => {
    window.history.replaceState(null, "", "/settings")
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "模型" })).not.toBeInTheDocument()
    expect(window.location.pathname).toBe("/settings")
  })

  it("restores jobs view from URL on load", async () => {
    window.history.replaceState(null, "", "/jobs")
    render(<App />)
    expect(await screen.findByText("暂无摄入任务")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/jobs")
  })

  it("restores ingest view from URL on load", async () => {
    window.history.replaceState(null, "", "/ingest")
    render(<App />)
    expect(await screen.findByTestId("ingest-raw-page")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/ingest")
  })

  it("restores chat view from root URL on load", async () => {
    window.history.replaceState(null, "", "/")
    render(<App />)
    expect(await screen.findByRole("button", { name: "模型" })).toBeInTheDocument()
    expect(await screen.findByTestId("ingest-message-panel")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/")
  })

  it("restores timeline view from URL on load when VC is enabled", async () => {
    vi.mocked(api.getVCStatus).mockResolvedValue(mockVCStatus(true))
    window.history.replaceState(null, "", "/timeline")
    render(<App />)
    expect(await screen.findByText("Loading timeline...")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/timeline")
  })
})
