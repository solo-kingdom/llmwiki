import type {
  Document,
  DocumentListItem,
  SearchResponse,
  Settings,
  ReferenceSummary,
  StalePage,
  IngestJob,
  IngestJobResponse,
  UploadIngestResponse,
  CapabilitiesResponse,
  IngestSession,
  IngestSessionMessage,
  ArchiveSessionResponse,
} from "@/types"

const BASE = ""

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const isFormData = init?.body instanceof FormData
  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const res = await fetch(BASE + url, {
    headers,
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || res.statusText)
  }
  return res.json()
}

export function listDocuments(): Promise<DocumentListItem[]> {
  return request<DocumentListItem[]>("/api/v1/documents/")
}

export function getDocument(id: string): Promise<Document> {
  return request<Document>(`/api/v1/documents/${encodeURIComponent(id)}`)
}

export function searchDocuments(
  q: string,
  limit = 10,
): Promise<SearchResponse> {
  return request<SearchResponse>(
    `/api/v1/search/?q=${encodeURIComponent(q)}&limit=${limit}`,
  )
}

export function getSettings(): Promise<Settings> {
  return request<Settings>("/api/v1/settings")
}

export function updateSettings(
  settings: Partial<Settings>,
): Promise<Settings> {
  return request<Settings>("/api/v1/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  })
}

export function getBacklinks(id: string): Promise<ReferenceSummary[]> {
  return request<ReferenceSummary[]>(
    `/api/v1/graph/backlinks/${encodeURIComponent(id)}`,
  )
}

export function getForwardReferences(
  id: string,
): Promise<ReferenceSummary[]> {
  return request<ReferenceSummary[]>(
    `/api/v1/graph/forward/${encodeURIComponent(id)}`,
  )
}

export function getStalePages(): Promise<StalePage[]> {
  return request<StalePage[]>("/api/v1/graph/stale")
}

export function healthCheck(): Promise<{ status: string }> {
  return request<{ status: string }>("/api/v1/health")
}

export function createConversationIngestJob(payload: {
  content: string
  title?: string
  source_ref?: string
}): Promise<IngestJobResponse> {
  return request<IngestJobResponse>("/api/v1/ingest/jobs/conversation", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createTextIngestJob(payload: {
  content: string
  title?: string
  filename?: string
  source_ref?: string
}): Promise<IngestJobResponse> {
  return request<IngestJobResponse>("/api/v1/ingest/jobs/text", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function uploadIngestJobs(
  files: File[],
  sourceRef = "upload",
): Promise<UploadIngestResponse> {
  const form = new FormData()
  for (const file of files) {
    form.append("files", file)
  }
  form.append("source_ref", sourceRef)
  return request<UploadIngestResponse>("/api/v1/ingest/jobs/upload", {
    method: "POST",
    body: form,
  })
}

export function listIngestJobs(limit = 50): Promise<IngestJob[]> {
  return request<IngestJob[]>(`/api/v1/ingest/jobs/?limit=${limit}`)
}

export function retryIngestJob(id: string): Promise<IngestJobResponse> {
  return request<IngestJobResponse>(
    `/api/v1/ingest/jobs/${encodeURIComponent(id)}/retry`,
    { method: "POST" },
  )
}

export function cancelIngestJob(id: string): Promise<{ status: string; message?: string }> {
  return request<{ status: string; message?: string }>(
    `/api/v1/ingest/jobs/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  )
}

export function getCapabilities(): Promise<CapabilitiesResponse> {
  return request<CapabilitiesResponse>("/api/v1/capabilities")
}

export function createIngestSession(title?: string): Promise<{ session: IngestSession }> {
  return request<{ session: IngestSession }>("/api/v1/ingest/sessions", {
    method: "POST",
    body: JSON.stringify({ title: title ?? "" }),
  })
}

export function getIngestSession(id: string): Promise<{ session: IngestSession }> {
  return request<{ session: IngestSession }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(id)}`,
  )
}

export function listIngestSessionMessages(
  sessionId: string,
): Promise<{ messages: IngestSessionMessage[] }> {
  return request<{ messages: IngestSessionMessage[] }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/messages`,
  )
}

export function appendIngestSessionMessage(
  sessionId: string,
  content: string,
): Promise<{ message: IngestSessionMessage }> {
  return request<{ message: IngestSessionMessage }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  )
}

export type SessionStreamHandler = (
  event: string,
  data: unknown,
) => void

export async function streamIngestSessionMessage(
  sessionId: string,
  content: string,
  onEvent: SessionStreamHandler,
): Promise<void> {
  const res = await fetch(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/messages?stream=1`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ content }),
    },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || res.statusText)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error("no response body")
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() ?? ""
    for (const part of parts) {
      const lines = part.split("\n")
      let event = "message"
      let data = ""
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim()
        if (line.startsWith("data:")) data = line.slice(5).trim()
      }
      if (data) {
        try {
          onEvent(event, JSON.parse(data))
        } catch {
          onEvent(event, data)
        }
      }
    }
  }
}

export function uploadIngestSessionAttachment(
  sessionId: string,
  file: File,
): Promise<{
  attachment_id: string
  path: string
  message: IngestSessionMessage
}> {
  const form = new FormData()
  form.append("file", file)
  return request(`/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/attachments`, {
    method: "POST",
    body: form,
  })
}

export function archiveIngestSession(
  sessionId: string,
  title?: string,
): Promise<ArchiveSessionResponse> {
  return request<ArchiveSessionResponse>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/archive`,
    {
      method: "POST",
      body: JSON.stringify({ title: title ?? "" }),
    },
  )
}
