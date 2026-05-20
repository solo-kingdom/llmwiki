import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { AppProvider, useApp } from "@/context/AppContext"
import type { IngestSessionMessage } from "@/types"

const mockListIngestSessionMessages = vi.fn()
const mockGetIngestSession = vi.fn()

vi.mock("@/lib/api", () => ({
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
  createIngestSession: vi.fn(),
  getIngestSession: (...args: unknown[]) => mockGetIngestSession(...args),
  listIngestSessionMessages: (...args: unknown[]) =>
    mockListIngestSessionMessages(...args),
  streamIngestSessionMessage: vi.fn(),
  uploadIngestSessionAttachment: vi.fn(),
  archiveIngestSession: vi.fn(),
  createConversationIngestJob: vi.fn(),
  createTextIngestJob: vi.fn(),
  uploadIngestJobs: vi.fn(),
  listProviders: vi.fn().mockResolvedValue([]),
}))

function streamingAssistant(content: string): IngestSessionMessage {
  return {
    id: "msg-assistant",
    session_id: "sess-1",
    role: "assistant",
    content,
    message_type: "text",
    attachment_id: "",
    stream_status: "streaming",
    created_at: "2026-01-01T00:00:00Z",
  }
}

function completeAssistant(content: string): IngestSessionMessage {
  return {
    ...streamingAssistant(content),
    stream_status: "complete",
  }
}

function Probe({
  onUpdate,
}: {
  onUpdate: (state: ReturnType<typeof useApp>) => void
}) {
  const app = useApp()
  onUpdate(app)
  return null
}

function SessionLoader() {
  const { ensureIngestSession } = useApp()
  useEffect(() => {
    void ensureIngestSession()
  }, [ensureIngestSession])
  return null
}

describe("AppContext streaming recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem("llmwiki.ingest.sessionId", "sess-1")
    mockGetIngestSession.mockResolvedValue({
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
    })
  })

  it(
    "polls streaming messages after session load until complete",
    async () => {
      mockListIngestSessionMessages
        .mockResolvedValueOnce({ messages: [streamingAssistant("hel")] })
        .mockResolvedValueOnce({ messages: [streamingAssistant("hello wor")] })
        .mockResolvedValueOnce({ messages: [completeAssistant("hello world")] })

      let latestMessages: IngestSessionMessage[] = []
      let latestBusy = false

      render(
        <AppProvider>
          <SessionLoader />
          <Probe
            onUpdate={(app) => {
              latestMessages = app.sessionMessages
              latestBusy = app.sessionBusy
            }}
          />
        </AppProvider>,
      )

      await waitFor(
        () => {
          expect(mockListIngestSessionMessages).toHaveBeenCalled()
        },
        { timeout: 3000 },
      )

      await waitFor(
        () => {
          expect(latestMessages.some((m) => m.content === "hello world")).toBe(
            true,
          )
          expect(latestBusy).toBe(false)
        },
        { timeout: 5000 },
      )

      expect(mockListIngestSessionMessages.mock.calls.length).toBeGreaterThanOrEqual(
        3,
      )
    },
    10000,
  )
})
