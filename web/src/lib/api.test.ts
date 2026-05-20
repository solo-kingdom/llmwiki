import { describe, it, expect, vi, beforeEach } from "vitest"
import type {
  Provider,
  ModelInfo,
  IngestSession,
  SessionListItem,
} from "@/types"

// Mock fetch globally
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

function mockResponse<T>(data: T, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  } as Response)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// --- Provider API tests ---

describe("listProviders", () => {
  it("calls GET /api/v1/providers and returns providers", async () => {
    const { listProviders } = await import("@/lib/api")
    const providers: Provider[] = [
      {
        id: "openai",
        name: "OpenAI",
        api_base: "https://api.openai.com/v1",
        api_format: "openai",
        env_key: "OPENAI_API_KEY",
        doc_url: "https://platform.openai.com",
      },
      {
        id: "anthropic",
        name: "Anthropic",
        api_base: "https://api.anthropic.com",
        api_format: "anthropic",
        env_key: "ANTHROPIC_API_KEY",
        doc_url: "https://docs.anthropic.com",
      },
    ]
    mockFetch.mockReturnValue(mockResponse(providers))

    const result = await listProviders()

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/providers",
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("openai")
    expect(result[1].id).toBe("anthropic")
  })

  it("throws on server error", async () => {
    const { listProviders } = await import("@/lib/api")
    mockFetch.mockReturnValue(
      mockResponse({ error: "internal error" }, false, 500),
    )

    await expect(listProviders()).rejects.toThrow("internal error")
  })
})

describe("listProviderModels", () => {
  it("calls GET /api/v1/providers/{id}/models", async () => {
    const { listProviderModels } = await import("@/lib/api")
    const models: ModelInfo[] = [
      {
        provider_id: "openai",
        model_id: "gpt-4o",
        name: "GPT-4o",
        family: "GPT-4",
        context_limit: 128000,
        output_limit: 16384,
        cost_input: 2.5,
        cost_output: 10.0,
        reasoning: true,
        tool_call: true,
        attachment: true,
      },
    ]
    mockFetch.mockReturnValue(mockResponse(models))

    const result = await listProviderModels("openai")

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/providers/openai/models",
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].model_id).toBe("gpt-4o")
    expect(result[0].reasoning).toBe(true)
  })
})

// --- Settings API tests ---

describe("updateLastModel", () => {
  it("calls PUT /api/v1/settings/last-model", async () => {
    const { updateLastModel } = await import("@/lib/api")
    mockFetch.mockReturnValue(
      mockResponse({ status: "ok" }),
    )

    const result = await updateLastModel("inst-1", "gpt-4o")

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/settings/last-model",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ instance_id: "inst-1", model: "gpt-4o" }),
      }),
    )
    expect(result).toBeDefined()
  })
})

// --- Session API tests ---

describe("listIngestSessions", () => {
  it("calls GET /api/v1/ingest/sessions", async () => {
    const { listIngestSessions } = await import("@/lib/api")
    const sessions: { sessions: SessionListItem[] } = {
      sessions: [
        {
          id: "s-1",
          title: "Session 1",
          status: "active",
          llm_instance_id: "inst-1",
          llm_model: "gpt-4o",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "s-2",
          title: "Session 2",
          status: "archived",
          llm_instance_id: "inst-2",
          llm_model: "claude-3",
          created_at: "2026-01-02T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ],
    }
    mockFetch.mockReturnValue(mockResponse(sessions))

    const result = await listIngestSessions()

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/ingest/sessions",
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0].llm_instance_id).toBe("inst-1")
    expect(result.sessions[1].status).toBe("archived")
  })

  it("handles empty sessions list", async () => {
    const { listIngestSessions } = await import("@/lib/api")
    mockFetch.mockReturnValue(mockResponse({ sessions: [] }))

    const result = await listIngestSessions()
    expect(result.sessions).toHaveLength(0)
  })
})

describe("updateIngestSession", () => {
  it("calls PATCH /api/v1/ingest/sessions/{id} with instance_id and model", async () => {
    const { updateIngestSession } = await import("@/lib/api")
    const updatedSession: IngestSession = {
      id: "s-1",
      title: "Session 1",
      status: "active",
      storage_path: "raw/sources/web-ingest/sessions/s-1",
      llm_instance_id: "inst-3",
      llm_model: "llama-3.1-70b",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }
    mockFetch.mockReturnValue(mockResponse({ session: updatedSession }))

    const result = await updateIngestSession("s-1", {
      instance_id: "inst-3",
      model: "llama-3.1-70b",
    })

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/ingest/sessions/s-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ instance_id: "inst-3", model: "llama-3.1-70b" }),
      }),
    )
    expect(result.session.llm_instance_id).toBe("inst-3")
  })

  it("sends only title when just title is provided", async () => {
    const { updateIngestSession } = await import("@/lib/api")
    mockFetch.mockReturnValue(
      mockResponse({
        session: {
          id: "s-1",
          title: "New Title",
          status: "active",
          storage_path: "",
          llm_instance_id: "",
          llm_model: "",
          created_at: "",
          updated_at: "",
        },
      }),
    )

    await updateIngestSession("s-1", { title: "New Title" })

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/ingest/sessions/s-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "New Title" }),
      }),
    )
  })

  it("throws on error response", async () => {
    const { updateIngestSession } = await import("@/lib/api")
    mockFetch.mockReturnValue(
      mockResponse({ error: "session not found" }, false, 404),
    )

    await expect(
      updateIngestSession("nonexistent", { instance_id: "inst-1" }),
    ).rejects.toThrow("session not found")
  })
})

describe("deleteIngestSession", () => {
  it("calls DELETE /api/v1/ingest/sessions/{id}", async () => {
    const { deleteIngestSession } = await import("@/lib/api")
    mockFetch.mockReturnValue(mockResponse({ status: "deleted" }))

    const result = await deleteIngestSession("s-1")

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/ingest/sessions/s-1",
      expect.objectContaining({ method: "DELETE" }),
    )
    expect(result.status).toBe("deleted")
  })
})

// --- Error handling tests ---

describe("API error handling", () => {
  it("throws with error message from JSON response", async () => {
    const { listProviders } = await import("@/lib/api")
    mockFetch.mockReturnValue(
      mockResponse({ error: "database connection failed" }, false, 500),
    )

    await expect(listProviders()).rejects.toThrow("database connection failed")
  })

  it("falls back to statusText when JSON parsing fails", async () => {
    const { listProviders } = await import("@/lib/api")
    mockFetch.mockReturnValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("invalid json")),
      statusText: "Service Unavailable",
    } as Response)

    await expect(listProviders()).rejects.toThrow("Service Unavailable")
  })
})
