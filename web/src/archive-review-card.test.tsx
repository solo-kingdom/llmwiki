import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ArchiveReviewCard } from "@/components/ArchiveReviewCard"
import * as api from "@/lib/api"
import { I18nTestProvider } from "@/test/i18n"

vi.mock("@/lib/api", () => ({
  getIngestReview: vi.fn(),
  getIngestJob: vi.fn(),
  listIngestReviewPlans: vi.fn(),
  addIngestReviewFeedback: vi.fn(),
  replanIngestReview: vi.fn(),
  approveIngestReview: vi.fn(),
}))

describe("ArchiveReviewCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listIngestReviewPlans).mockResolvedValue([
      {
        id: "plan-1",
        review_id: "review-1",
        version: 1,
        plan_markdown: "## Plan\n\nCreate wiki/foo.md",
        plan_json: "{}",
        created_at: "",
      },
    ])
  })

  it("shows review card with plan after archive", async () => {
    vi.mocked(api.getIngestReview).mockResolvedValue({
      id: "review-1",
      session_id: "sess-1",
      archive_source_path: "raw/test.md",
      status: "ready_for_review",
      current_plan_version: 1,
      approved_plan_version: 0,
      created_at: "",
      updated_at: "",
    })

    render(
      <I18nTestProvider lang="zh">
        <ArchiveReviewCard reviewId="review-1" />
      </I18nTestProvider>,
    )

    expect(await screen.findByText("归档审阅")).toBeInTheDocument()
    expect(await screen.findByText("Create wiki/foo.md")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "确认计划并执行" })).toBeInTheDocument()
  })

  it("shows diff link when merge commit exists", async () => {
    vi.mocked(api.getIngestReview).mockResolvedValue({
      id: "review-1",
      session_id: "sess-1",
      archive_source_path: "raw/test.md",
      status: "succeeded",
      current_plan_version: 1,
      approved_plan_version: 1,
      final_job_id: "job-apply-1",
      merge_commit_sha: "abc123def",
      created_at: "",
      updated_at: "",
    })
    vi.mocked(api.getIngestJob).mockResolvedValue({
      job: {
        id: "job-apply-1",
        parent_job_id: "",
        input_type: "review_apply",
        source_path: "raw/test.md",
        source_ref: "review:review-1",
        status: "succeeded",
        retries: 0,
        max_retries: 3,
        error: "",
        error_code: "",
        error_message: "",
        missing_dependency: "",
        remediation: "",
        result_summary: "applied 2 wiki page(s) from approved plan v1",
        created_at: "",
        updated_at: "",
      },
    })

    render(
      <I18nTestProvider lang="zh">
        <ArchiveReviewCard reviewId="review-1" />
      </I18nTestProvider>,
    )

    expect(await screen.findByRole("button", { name: "查看变更" })).toBeInTheDocument()
  })

  it("shows zero-page failure when apply job has no_wiki_files_written", async () => {
    vi.mocked(api.getIngestReview).mockResolvedValue({
      id: "review-1",
      session_id: "sess-1",
      archive_source_path: "raw/test.md",
      status: "failed",
      current_plan_version: 1,
      approved_plan_version: 1,
      final_job_id: "job-apply-1",
      created_at: "",
      updated_at: "",
    })
    vi.mocked(api.getIngestJob).mockResolvedValue({
      job: {
        id: "job-apply-1",
        parent_job_id: "",
        input_type: "review_apply",
        source_path: "raw/test.md",
        source_ref: "review:review-1",
        status: "failed",
        retries: 0,
        max_retries: 3,
        error: "no wiki files written",
        error_code: "no_wiki_files_written",
        error_message: "no wiki files written from FILE blocks",
        missing_dependency: "",
        remediation: "replan or check job logs",
        result_summary: "",
        created_at: "",
        updated_at: "",
      },
    })

    render(
      <I18nTestProvider lang="zh">
        <ArchiveReviewCard reviewId="review-1" />
      </I18nTestProvider>,
    )

    expect(
      await screen.findByText(/归档执行未写入任何 wiki 页面/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Wiki 页面已成功更新/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重新规划" })).toBeInTheDocument()
  })

  it("hides diff link when version control was off", async () => {
    vi.mocked(api.getIngestReview).mockResolvedValue({
      id: "review-1",
      session_id: "sess-1",
      archive_source_path: "raw/test.md",
      status: "succeeded",
      current_plan_version: 1,
      approved_plan_version: 1,
      created_at: "",
      updated_at: "",
    })

    render(
      <I18nTestProvider lang="zh">
        <ArchiveReviewCard reviewId="review-1" />
      </I18nTestProvider>,
    )

    expect(await screen.findByText(/git 仓库未初始化/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "查看变更" })).not.toBeInTheDocument()
  })
})
