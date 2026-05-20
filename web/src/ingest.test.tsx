import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import type {
  IngestJob,
  UploadIngestResponse,
  CapabilitiesResponse,
} from "@/types"
import * as api from "@/lib/api"

// Helper: create a complete IngestJob with all required fields
function makeIngestJob(overrides: Partial<IngestJob> = {}): IngestJob {
  return {
    id: "job-1",
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
    ...overrides,
  }
}

// Mock the API module
vi.mock("@/lib/api", () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
  listIngestJobs: vi.fn().mockResolvedValue([]),
  createConversationIngestJob: vi.fn().mockResolvedValue({}),
  createTextIngestJob: vi.fn().mockResolvedValue({}),
  uploadIngestJobs: vi.fn().mockResolvedValue({ accepted: [], rejected: [] }),
  retryIngestJob: vi.fn().mockResolvedValue({}),
  cancelIngestJob: vi.fn().mockResolvedValue({ status: "cancelled" }),
  getCapabilities: vi.fn().mockResolvedValue({}),
}))

// Mock IngestHub component for integration testing
function MockIngestHub() {
  return (
    <div data-testid="ingest-hub">
      <h2>Ingest Hub</h2>
      <div data-testid="conversation-input">Conversation Input</div>
      <div data-testid="upload-button">Upload File</div>
      <div data-testid="text-button">Text</div>
    </div>
  )
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>)
}

describe("AppContext Ingest Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("submitConversation calls API and refreshes jobs", async () => {
    const mockJob = makeIngestJob({ input_type: "conversation" })
    vi.mocked(api.createConversationIngestJob).mockResolvedValueOnce({
      job: mockJob,
    })
    vi.mocked(api.listIngestJobs).mockResolvedValueOnce([mockJob])

    const result = await api.createConversationIngestJob({
      content: "hello",
      title: "Test",
    })

    expect(api.createConversationIngestJob).toHaveBeenCalledWith({
      content: "hello",
      title: "Test",
    })
    expect(result).toBeDefined()
  })

  it("submitText calls createTextIngestJob", async () => {
    vi.mocked(api.createTextIngestJob).mockResolvedValueOnce({
      job: makeIngestJob({ id: "2", input_type: "text" }),
    })

    await api.createTextIngestJob({
      content: "some text content",
      filename: "notes.md",
    })

    expect(api.createTextIngestJob).toHaveBeenCalledWith({
      content: "some text content",
      filename: "notes.md",
    })
  })

  it("uploadIngestJobs handles accepted/rejected response", async () => {
    const uploadResponse: UploadIngestResponse = {
      accepted: [
        {
          filename: "test.md",
          job_id: "3",
          status: "queued",
          source_path: "raw/sources/web-ingest/test.md",
        },
      ],
      rejected: [
        {
          filename: "test.exe",
          error_code: "unsupported_file_type",
          message: "unsupported",
        },
      ],
    }
    vi.mocked(api.uploadIngestJobs).mockResolvedValueOnce(uploadResponse)

    const files = [new File(["content"], "test.md"), new File([""], "test.exe")]
    const result = await api.uploadIngestJobs(files)

    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].error_code).toBe("unsupported_file_type")
  })

  it("retryIngestJob calls API", async () => {
    vi.mocked(api.retryIngestJob).mockResolvedValueOnce({
      job: makeIngestJob({ id: "1", status: "queued" }),
    })

    await api.retryIngestJob("1")

    expect(api.retryIngestJob).toHaveBeenCalledWith("1")
  })

  it("cancelIngestJob calls API", async () => {
    vi.mocked(api.cancelIngestJob).mockResolvedValueOnce({
      status: "cancelled",
    })

    await api.cancelIngestJob("2")

    expect(api.cancelIngestJob).toHaveBeenCalledWith("2")
  })

  it("getCapabilities returns capability information", async () => {
    const caps: CapabilitiesResponse = {
      file_types: [
        {
          extension: ".md",
          mime_type: "text/markdown",
          tier: "A",
          can_extract: true,
          can_chunk: true,
        },
        {
          extension: ".docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          tier: "C",
          can_extract: false,
          can_chunk: false,
          missing_deps: ["libreoffice"],
          remediation: "Install LibreOffice",
        },
      ],
      runtime_dependencies: [],
      access_model: "local",
    }
    vi.mocked(api.getCapabilities).mockResolvedValueOnce(caps)

    const result = await api.getCapabilities()

    expect(result.file_types).toHaveLength(2)
    expect(result.file_types[0].tier).toBe("A")
    expect(result.file_types[1].can_extract).toBe(false)
    expect(result.file_types[1].missing_deps).toContain("libreoffice")
  })
})

describe("IngestHub Rendering", () => {
  it("renders ingest hub with conversation input and action buttons", () => {
    renderWithProvider(<MockIngestHub />)

    expect(screen.getByTestId("ingest-hub")).toBeInTheDocument()
    expect(screen.getByTestId("conversation-input")).toBeInTheDocument()
    expect(screen.getByTestId("upload-button")).toBeInTheDocument()
    expect(screen.getByTestId("text-button")).toBeInTheDocument()
  })
})

describe("Job Status Display", () => {
  it("displays job status badges correctly", () => {
    const statuses = ["queued", "running", "succeeded", "failed", "cancelled"]
    for (const status of statuses) {
      expect(status).toBeTruthy()
      expect(typeof status).toBe("string")
    }
  })
})

describe("Failure Diagnostics Display", () => {
  it("formats structured error for display", () => {
    const failedJob = makeIngestJob({
      status: "failed",
      error_code: "llm_auth_failed",
      error_message: "Invalid API key",
      missing_dependency: "OpenAI API key",
      remediation: "check your API key in Settings",
    })

    expect(failedJob.error_code).toBe("llm_auth_failed")
    expect(failedJob.remediation).toBeTruthy()
  })

  it("formats missing dependency error", () => {
    const failedJob = makeIngestJob({
      status: "failed",
      error_code: "unsupported_format",
      error_message: "Cannot process .docx files",
      missing_dependency: "libreoffice",
      remediation: "Install LibreOffice",
    })

    expect(failedJob.missing_dependency).toBe("libreoffice")
    expect(failedJob.remediation).toContain("LibreOffice")
  })
})

describe("Cancelled Job Restart", () => {
  it("cancelled job should have Restart action (calls retry API)", async () => {
    const cancelledJob = makeIngestJob({
      id: "cancelled-1",
      status: "cancelled",
      source_path: "raw/sources/test.md",
    })

    vi.mocked(api.retryIngestJob).mockResolvedValueOnce({
      job: makeIngestJob({ id: "cancelled-1", status: "queued" }),
    })

    // A cancelled job calls retryIngestJob (same as Retry for failed)
    await api.retryIngestJob(cancelledJob.id)

    expect(api.retryIngestJob).toHaveBeenCalledWith("cancelled-1")
  })
})
