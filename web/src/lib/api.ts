import type {
  Document,
  DocumentListItem,
  SearchResponse,
  Settings,
  ReferenceSummary,
  StalePage,
} from "@/types"

const BASE = ""

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { "Content-Type": "application/json" },
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
