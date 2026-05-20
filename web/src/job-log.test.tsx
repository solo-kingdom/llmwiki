import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { JobCard } from "@/components/JobCard"
import { JobLogDialog } from "@/components/JobLogDialog"
import type { IngestJob, IngestJobEvent } from "@/types"
import * as api from "@/lib/api"

function makeJob(overrides: Partial<IngestJob> = {}): IngestJob {
  return {
    id: "job-1",
    parent_job_id: "",
    input_type: "text",
    source_path: "raw/sources/test.md",
    source_ref: "",
    status: "running",
    retries: 0,
    max_retries: 3,
    error: "",
    error_code: "",
    error_message: "",
    missing_dependency: "",
    remediation: "",
    result_summary: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

vi.mock("@/lib/api", () => ({
  getIngestJobEvents: vi.fn(),
}))

describe("JobCard log button", () => {
  it("shows log button for running jobs", () => {
    const onViewLog = vi.fn()
    render(
      <JobCard
        job={makeJob({ status: "running" })}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onViewLog={onViewLog}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "日志" }))
    expect(onViewLog).toHaveBeenCalled()
  })

  it("hides log button for queued jobs", () => {
    render(
      <JobCard
        job={makeJob({ status: "queued" })}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onViewLog={vi.fn()}
      />,
    )
    expect(screen.queryByRole("button", { name: "日志" })).toBeNull()
  })
})

describe("JobLogDialog", () => {
  beforeEach(() => {
    vi.mocked(api.getIngestJobEvents).mockResolvedValue({
      events: [
        {
          id: 1,
          job_id: "job-1",
          step: "system",
          phase: "stale_recovered",
          message: "requeued",
          payload: "{}",
          created_at: "2026-01-01T00:00:00Z",
        } as IngestJobEvent,
      ],
    })
  })

  it("shows stale recovered hint", async () => {
    render(
      <JobLogDialog open job={makeJob()} onOpenChange={vi.fn()} />,
    )
    expect(
      await screen.findByText(/心跳超时或服务重启被重新入队/),
    ).toBeInTheDocument()
  })
})
