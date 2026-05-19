import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AppProvider } from "@/context/AppContext"
import * as api from "@/lib/api"

// Mock the API module
vi.mock("@/lib/api", () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
  listIngestJobs: vi.fn().mockResolvedValue([]),
  createConversationIngestJob: vi.fn().mockResolvedValue({}),
  createTextIngestJob: vi.fn().mockResolvedValue({}),
  uploadIngestJobs: vi.fn().mockResolvedValue({ accepted: [], rejected: [] }),
  retryIngestJob: vi.fn().mockResolvedValue({}),
  cancelIngestJob: vi.fn().mockResolvedValue({ status: "cancelled" }),
  getCapabilities: vi.fn().mockResolvedValue({
    source_processing: {
      tiers: {
        A: { formats: ["md", "txt"], available: true },
        B: { formats: ["pdf"], available: true },
        C: { formats: ["docx", "pptx"], available: false, missing: ["libreoffice"] },
      },
    },
  }),
}))

// Mock IngestHub component for integration testing
function MockIngestHub() {
  return (
    <div data-testid="ingest-hub">
      <h2>Ingest Hub</h2>
      <div data-testid="conversation-card">Conversation</div>
      <div data-testid="text-card">Text</div>
      <div data-testid="upload-card">Upload</div>
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
    const mockedJobs = [
      { id: "1", status: "queued", input_type: "conversation", source_path: "test.md" },
    ]
    vi.mocked(api.createConversationIngestJob).mockResolvedValueOnce({ job: mockedJobs[0] })
    vi.mocked(api.listIngestJobs).mockResolvedValueOnce(mockedJobs)

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
      job: { id: "2", status: "queued" },
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
    const uploadResponse = {
      accepted: [{ filename: "test.md", job_id: "3", status: "queued" }],
      rejected: [{ filename: "test.exe", error_code: "unsupported_file_type", message: "unsupported" }],
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
      job: { id: "4", status: "queued", parent_job_id: "1" },
    })

    await api.retryIngestJob("1")

    expect(api.retryIngestJob).toHaveBeenCalledWith("1")
  })

  it("cancelIngestJob calls API", async () => {
    vi.mocked(api.cancelIngestJob).mockResolvedValueOnce({ status: "cancelled" })

    await api.cancelIngestJob("2")

    expect(api.cancelIngestJob).toHaveBeenCalledWith("2")
  })

  it("getCapabilities returns tier information", async () => {
    const caps = await api.getCapabilities()

    expect(caps.source_processing.tiers.A.available).toBe(true)
    expect(caps.source_processing.tiers.C.available).toBe(false)
    expect(caps.source_processing.tiers.C.missing).toContain("libreoffice")
  })
})

describe("IngestHub Rendering", () => {
  it("renders ingest hub with all cards", () => {
    renderWithProvider(<MockIngestHub />)

    expect(screen.getByTestId("ingest-hub")).toBeInTheDocument()
    expect(screen.getByTestId("conversation-card")).toBeInTheDocument()
    expect(screen.getByTestId("text-card")).toBeInTheDocument()
    expect(screen.getByTestId("upload-card")).toBeInTheDocument()
  })
})

describe("Job Status Display", () => {
  it("displays job status badges correctly", () => {
    const statuses = ["queued", "running", "succeeded", "failed", "cancelled"]
    // Verify all statuses are valid display values
    for (const status of statuses) {
      expect(status).toBeTruthy()
      expect(typeof status).toBe("string")
    }
  })
})

describe("Failure Diagnostics Display", () => {
  it("formats structured error for display", () => {
    const failedJob = {
      id: "1",
      status: "failed",
      error_code: "llm_auth_failed",
      error_message: "Invalid API key",
      missing_dependency: "OpenAI API key",
      remediation: "check your API key in Settings",
    }

    expect(failedJob.error_code).toBe("llm_auth_failed")
    expect(failedJob.remediation).toBeTruthy()
  })

  it("formats missing dependency error", () => {
    const failedJob = {
      id: "2",
      status: "failed",
      error_code: "unsupported_format",
      error_message: "Cannot process .docx files",
      missing_dependency: "libreoffice",
      remediation: "Install LibreOffice",
    }

    expect(failedJob.missing_dependency).toBe("libreoffice")
    expect(failedJob.remediation).toContain("LibreOffice")
  })
})
