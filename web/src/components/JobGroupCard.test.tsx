import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { JobGroupCard } from "./JobGroupCard"
import type { IngestJob } from "@/types"

// Mock i18n
vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      "jobs.group.archive_title": "Archive task",
      "jobs.group.history_count": `History (${params?.count ?? 0})`,
      "jobs.log": "Log",
      "jobs.retry": "Retry",
      "jobs.restart": "Restart",
      "jobs.cancel": "Cancel",
    }
    return map[key] ?? key
  },
}))

function makeJob(overrides: Partial<IngestJob> & { id: string }): IngestJob {
  return {
    parent_job_id: "",
    input_type: "file",
    source_path: "/test/file.md",
    source_ref: "review:abc123",
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

describe("JobGroupCard", () => {
  const defaultProps = {
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onPreviewSource: vi.fn(),
    onViewLog: vi.fn(),
  }

  it("renders active job info for single job without history section", () => {
    const jobs = [makeJob({ id: "1", status: "succeeded", source_path: "/data/archive.md" })]
    render(<JobGroupCard jobs={jobs} {...defaultProps} />)

    expect(screen.getByText("/data/archive.md")).toBeTruthy()
    // Should NOT show history section when only 1 job
    expect(screen.queryByText(/History/)).toBeNull()
  })

  it("shows history section when multiple jobs", () => {
    const jobs = [
      makeJob({ id: "1", status: "succeeded", created_at: "2025-01-02T00:00:00Z" }),
      makeJob({ id: "2", status: "failed", created_at: "2025-01-01T00:00:00Z" }),
      makeJob({ id: "3", status: "queued", created_at: "2025-01-01T00:00:00Z" }),
    ]
    render(<JobGroupCard jobs={jobs} {...defaultProps} />)

    // History section should be visible with count
    expect(screen.getByText("History (2)")).toBeTruthy()
  })

  it("expands and collapses history on click", () => {
    const jobs = [
      makeJob({ id: "1", status: "succeeded", created_at: "2025-01-02T00:00:00Z" }),
      makeJob({ id: "2", status: "failed", input_type: "review_apply", created_at: "2025-01-01T00:00:00Z" }),
    ]
    render(<JobGroupCard jobs={jobs} {...defaultProps} />)

    // History is collapsed by default - history job should not show input_type
    expect(screen.queryByText("review_apply")).toBeNull()

    // Click to expand
    const toggleBtn = screen.getByText("History (1)")
    fireEvent.click(toggleBtn)

    // Now history job info should be visible
    expect(screen.getByText("review_apply")).toBeTruthy()

    // Click to collapse
    fireEvent.click(toggleBtn)
    expect(screen.queryByText("review_apply")).toBeNull()
  })

  it("calls onRetry when Retry button is clicked for failed active job", () => {
    const onRetry = vi.fn()
    const jobs = [makeJob({ id: "j1", status: "failed" })]
    render(<JobGroupCard jobs={jobs} {...defaultProps} onRetry={onRetry} />)

    const retryBtn = screen.getByText("Retry")
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledWith("j1")
  })

  it("calls onCancel when Cancel button is clicked for running active job", () => {
    const onCancel = vi.fn()
    const jobs = [makeJob({ id: "j1", status: "running" })]
    render(<JobGroupCard jobs={jobs} {...defaultProps} onCancel={onCancel} />)

    const cancelBtn = screen.getByText("Cancel")
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledWith("j1")
  })

  it("calls onRetry (Restart) for cancelled active job", () => {
    const onRetry = vi.fn()
    const jobs = [makeJob({ id: "j1", status: "cancelled" })]
    render(<JobGroupCard jobs={jobs} {...defaultProps} onRetry={onRetry} />)

    const restartBtn = screen.getByText("Restart")
    fireEvent.click(restartBtn)
    expect(onRetry).toHaveBeenCalledWith("j1")
  })

  it("calls onViewLog when Log button is clicked", () => {
    const onViewLog = vi.fn()
    const jobs = [makeJob({ id: "j1", status: "succeeded" })]
    render(<JobGroupCard jobs={jobs} {...defaultProps} onViewLog={onViewLog} />)

    const logBtn = screen.getByText("Log")
    fireEvent.click(logBtn)
    expect(onViewLog).toHaveBeenCalledWith(jobs[0])
  })

  it("displays file name in group header", () => {
    const jobs = [makeJob({ id: "1", source_path: "/sessions/abc/archive.md" })]
    render(<JobGroupCard jobs={jobs} {...defaultProps} />)

    // The header should contain the file name
    const allMatches = screen.getAllByText(/archive\.md/)
    expect(allMatches.length).toBeGreaterThanOrEqual(1)
  })
})
