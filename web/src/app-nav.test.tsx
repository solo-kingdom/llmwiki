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

  it("defaults to ingest chat and uses button navigation", async () => {
    render(<App />)
    const nav = await screen.findByRole("navigation")
    expect(within(nav).getByRole("button", { name: "摄入" })).toBeInTheDocument()
    expect(within(nav).queryAllByRole("button", { name: "摄入" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "模型" })).toBeInTheDocument()
    expect(window.location.pathname).toBe("/")

    fireEvent.click(
      within(screen.getByRole("navigation")).getByRole("button", {
        name: "设置",
      }),
    )
    expect(
      await screen.findByRole("heading", { name: "设置" }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe("/settings")

    fireEvent.click(screen.getByRole("button", { name: "任务" }))
    expect(await screen.findByText("暂无摄入任务")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/jobs")

    fireEvent.click(screen.getByRole("button", { name: "日志" }))
    expect(await screen.findByText("暂无系统日志")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/logs")

    const wikiLink = screen.getByRole("link", { name: "Wiki" })
    expect(wikiLink).toHaveAttribute("href", "/wiki")
  })

  it("navigates to wiki reader shell when Wiki link is clicked", async () => {
    window.history.replaceState(null, "", "/")
    render(<App />)
    const nav = await screen.findByRole("navigation")
    expect(within(nav).getByRole("button", { name: "摄入" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("link", { name: "Wiki" }))
    expect(window.location.pathname).toBe("/wiki")
    expect(await screen.findByText("管理工作台")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "模型" })).not.toBeInTheDocument()
  })

  it("restores settings view from URL on load", async () => {
    window.history.replaceState(null, "", "/settings")
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "设置" }),
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

  it("redirects legacy ingest URL to chat and opens context dialog", async () => {
    window.history.replaceState(null, "", "/ingest")
    render(<App />)
    expect(await screen.findByTestId("context-input-dialog")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/")
    expect(window.location.search).toBe("")
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
    expect(await screen.findByText("加载时间线...")).toBeInTheDocument()
    expect(window.location.pathname).toBe("/timeline")
  })
})
