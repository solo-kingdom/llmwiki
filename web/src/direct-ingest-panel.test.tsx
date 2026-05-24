import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import { DirectIngestPanel } from "@/components/DirectIngestPanel"
import * as api from "@/lib/api"
import type { IngestJob } from "@/types"

vi.mock("@/lib/api", () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
  listIngestJobs: vi.fn().mockResolvedValue([]),
  createTextIngestJob: vi.fn(),
  uploadIngestJobs: vi.fn(),
  getCapabilities: vi.fn().mockResolvedValue({
    file_types: [],
    runtime_dependencies: [],
    access_model: "local",
  }),
}))

function makeJob(id: string): IngestJob {
  return {
    id,
    parent_job_id: "",
    input_type: "text",
    source_path: "raw/sources/web-ingest/test.md",
    source_ref: "text",
    status: "queued",
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
  }
}

function renderPanel(open = true) {
  const onOpenChange = vi.fn()
  render(
    <AppProvider>
      <DirectIngestPanel open={open} onOpenChange={onOpenChange} />
    </AppProvider>,
  )
  return { onOpenChange }
}

describe("DirectIngestPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listIngestJobs).mockResolvedValue([])
  })

  it("disables submit when no files or text blocks", async () => {
    renderPanel()
    expect(await screen.findByTestId("direct-ingest-panel")).toBeInTheDocument()
    expect(screen.getByTestId("direct-ingest-submit")).toBeDisabled()
    expect(
      screen.getByText("请至少添加一个文件或填写一个非空文本块"),
    ).toBeInTheDocument()
  })

  it("supports multiple text blocks and submits composed markdown", async () => {
    vi.mocked(api.createTextIngestJob).mockResolvedValueOnce({
      job: makeJob("text-job-1"),
    })

    renderPanel()
    await screen.findByTestId("direct-ingest-text-block-0")

    fireEvent.change(
      within(screen.getByTestId("direct-ingest-text-block-0")).getByPlaceholderText(
        "块标题（可选）",
      ),
      { target: { value: "Intro" } },
    )
    fireEvent.change(
      within(screen.getByTestId("direct-ingest-text-block-0")).getByPlaceholderText(
        "正文（必填，至少一个非空文本块才能提交）",
      ),
      { target: { value: "First block" } },
    )

    fireEvent.click(screen.getByRole("button", { name: "新增文本块" }))
    const secondBlock = await screen.findByTestId("direct-ingest-text-block-1")
    fireEvent.change(
      within(secondBlock).getByPlaceholderText(
        "正文（必填，至少一个非空文本块才能提交）",
      ),
      { target: { value: "Second block" } },
    )

    fireEvent.click(screen.getByTestId("direct-ingest-submit"))

    await waitFor(() => {
      expect(api.createTextIngestJob).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("First block"),
          title: undefined,
        }),
      )
    })

    expect(await screen.findByTestId("direct-ingest-submit-summary")).toHaveTextContent(
      "text-job-1",
    )
  })

  it("lists selected files and submits uploads", async () => {
    vi.mocked(api.uploadIngestJobs).mockResolvedValueOnce({
      accepted: [
        {
          filename: "notes.md",
          job_id: "file-job-1",
          status: "queued",
          source_path: "raw/sources/web-ingest/notes.md",
        },
      ],
      rejected: [],
    })

    renderPanel()
    const input = await screen.findByTestId("direct-ingest-file-input")
    const file = new File(["hello"], "notes.md", { type: "text/markdown" })
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByTestId("direct-ingest-file-list")).toHaveTextContent(
      "notes.md",
    )

    fireEvent.click(screen.getByTestId("direct-ingest-submit"))

    await waitFor(() => {
      expect(api.uploadIngestJobs).toHaveBeenCalled()
    })
    expect(await screen.findByTestId("direct-ingest-submit-summary")).toHaveTextContent(
      "file-job-1",
    )
  })

  it("summarizes mixed submit with partial file failure", async () => {
    vi.mocked(api.createTextIngestJob).mockResolvedValueOnce({
      job: makeJob("text-job-2"),
    })
    vi.mocked(api.uploadIngestJobs).mockResolvedValueOnce({
      accepted: [
        {
          filename: "ok.md",
          job_id: "file-ok",
          status: "queued",
          source_path: "raw/sources/web-ingest/ok.md",
        },
      ],
      rejected: [
        {
          filename: "bad.exe",
          error_code: "unsupported_file_type",
          message: "unsupported",
        },
      ],
    })

    renderPanel()
    await screen.findByTestId("direct-ingest-text-block-0")

    fireEvent.change(
      screen.getByPlaceholderText("正文（必填，至少一个非空文本块才能提交）"),
      { target: { value: "Batch text" } },
    )

    const input = screen.getByTestId("direct-ingest-file-input")
    fireEvent.change(input, {
      target: {
        files: [
          new File(["a"], "ok.md", { type: "text/markdown" }),
          new File(["b"], "bad.exe", { type: "application/octet-stream" }),
        ],
      },
    })

    fireEvent.click(screen.getByTestId("direct-ingest-submit"))

    const summary = await screen.findByTestId("direct-ingest-submit-summary")
    expect(summary).toHaveTextContent("text-job-2")
    expect(summary).toHaveTextContent("file-ok")
    expect(summary).toHaveTextContent("bad.exe")
    expect(summary).toHaveTextContent("unsupported")
    expect(screen.getByRole("button", { name: "查看 Jobs" })).toBeInTheDocument()
  })
})
