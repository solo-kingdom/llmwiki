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
