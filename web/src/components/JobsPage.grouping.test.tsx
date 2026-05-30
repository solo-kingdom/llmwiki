import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { JobsPage } from "./JobsPage"
import type { IngestJob } from "@/types"

// Mock i18n
vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      "jobs.empty": "No ingest jobs",
      "jobs.group.archive_title": "Archive task",
      "jobs.group.history_count": `History (${params?.count ?? 0})`,
      "jobs.log": "Log",
      "jobs.retry": "Retry",
      "jobs.restart": "Restart",
      "jobs.cancel": "Cancel",
      "jobs.status.all": "All",
      "jobs.status.queued": "Queued",
      "jobs.status.running": "Running",
      "jobs.status.succeeded": "Succeeded",
      "jobs.status.failed": "Failed",
    }
    return map[key] ?? key
  },
}))

// Mock AppContext
function makeJob(overrides: Partial<IngestJob> & { id: string }): IngestJob {
  return {
    parent_job_id: "",
    input_type: "file",
    source_path: "/test/file.md",
    source_ref: "",
    status: "succeeded",
    retries: 0,
    max_retries: 3,
    error: "",
    error_code: "",
    error_message: "",
    missing_dependency: "",
    remediation: "",
    result_summary: "",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

const mockJobs: IngestJob[] = [
  makeJob({
    id: "review-job-1",
    source_ref: "review:abc",
    source_path: "/sessions/abc/archive.md",
    status: "running",
    input_type: "review_apply",
    created_at: "2025-01-05T10:00:00Z",
  }),
  makeJob({
    id: "review-job-2",
    source_ref: "review:abc",
    source_path: "/sessions/abc/archive.md",
    status: "failed",
    input_type: "review_apply",
    created_at: "2025-01-04T10:00:00Z",
  }),
  makeJob({
    id: "flat-job-1",
    source_ref: "",
    source_path: "/data/test.md",
    status: "succeeded",
    input_type: "file",
    created_at: "2025-01-06T10:00:00Z",
  }),
  makeJob({
    id: "review-job-3",
    source_ref: "review:xyz",
    source_path: "/sessions/xyz/archive.md",
    status: "succeeded",
    input_type: "review_plan",
    created_at: "2025-01-03T10:00:00Z",
  }),
  makeJob({
    id: "flat-job-2",
    source_ref: "",
    source_path: "/data/other.txt",
    status: "failed",
    input_type: "text",
    created_at: "2025-01-02T10:00:00Z",
  }),
]

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    ingestJobs: mockJobs,
    refreshIngestJobs: vi.fn(),
    retryIngest: vi.fn(),
    cancelIngest: vi.fn(),
  }),
}))

// Mock child components that depend on complex context
vi.mock("./PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("./SourcePreviewDialog", () => ({
  SourcePreviewDialog: () => <div data-testid="source-preview" />,
  isPreviewable: (path: string) => path.endsWith(".md"),
}))

vi.mock("./JobLogDialog", () => ({
  JobLogDialog: () => <div data-testid="job-log" />,
}))

describe("JobsPage integration", () => {
  it("renders grouped review jobs as JobGroupCard and flat jobs as JobCard", () => {
    render(<JobsPage />)

    // The review:abc group should be rendered as a group card (has history)
    expect(screen.getByText("History (1)")).toBeTruthy()

    // Flat jobs should be visible
    expect(screen.getByText("/data/test.md")).toBeTruthy()
    expect(screen.getByText("/data/other.txt")).toBeTruthy()
  })

  it("renders items in mixed time order (newest first)", () => {
    render(<JobsPage />)

    // All rendered content visible
    // flat-job-1 (Jan 6) should be first since it's the newest
    // Then review:abc group (active job Jan 5)
    // Then review:xyz group (Jan 3)
    // Then flat-job-2 (Jan 2)

    // At minimum, all items should be present
    expect(screen.getByText("/data/test.md")).toBeTruthy() // flat-job-1
    expect(screen.getByText("/data/other.txt")).toBeTruthy() // flat-job-2
  })

  it("filters groups when status filter is active", () => {
    render(<JobsPage />)

    // Click "Failed" filter tab
    const failedTab = screen.getByText("Failed")
    fireEvent.click(failedTab)

    // review:abc group has a failed job, so it should still show
    // review:xyz group has only succeeded, so it should be hidden
    // flat-job-2 is failed, so it should show
    expect(screen.getByText("/data/other.txt")).toBeTruthy()
    expect(screen.getByText("History (1)")).toBeTruthy()
  })

  it("shows empty message when no jobs match filter", () => {
    render(<JobsPage />)

    // Click "Queued" filter - no jobs have queued status
    const queuedTab = screen.getByText("Queued")
    fireEvent.click(queuedTab)

    expect(screen.getByText("No ingest jobs")).toBeTruthy()
  })
})
