import type {
  Document,
  DocumentListItem,
  SearchResponse,
  Settings,
  ReferenceSummary,
  StalePage,
  IngestJob,
  IngestJobResponse,
  IngestJobEventsResponse,
  UploadIngestResponse,
  CapabilitiesResponse,
  IngestSession,
  IngestSessionMessage,
  ArchiveSessionResponse,
  Provider,
  ProviderInstance,
  ModelInfo,
  PublicWikiDocument,
  SessionListItem,
  VCStatus,
  VCLogEntry,
  ProviderCheckResult,
  MCPServerCheckResult,
  ActivityLog,
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

export function getPublicWikiStatus(): Promise<{ enabled: boolean }> {
  return request<{ enabled: boolean }>("/api/public/wiki/status")
}

export function listPublicDocuments(): Promise<DocumentListItem[]> {
  return request<DocumentListItem[]>("/api/public/wiki/documents")
}

export function getPublicDocument(id: string): Promise<PublicWikiDocument> {
  return request<PublicWikiDocument>(
    `/api/public/wiki/documents/${encodeURIComponent(id)}`,
  )
}

export function searchPublicWiki(
  q: string,
  limit = 10,
): Promise<SearchResponse> {
  return request<SearchResponse>(
    `/api/public/wiki/search?q=${encodeURIComponent(q)}&limit=${limit}`,
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

export type ActivityLogListResponse = {
  logs: ActivityLog[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}

export function listActivityLogs(params?: {
  limit?: number
  offset?: number
  category?: string
  level?: string
}): Promise<ActivityLogListResponse> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set("limit", String(params.limit))
  if (params?.offset != null) q.set("offset", String(params.offset))
  if (params?.category) q.set("category", params.category)
  if (params?.level) q.set("level", params.level)
  const qs = q.toString()
  return request<ActivityLogListResponse>(
    `/api/v1/logs${qs ? `?${qs}` : ""}`,
  )
}

export function clearActivityLogs(): Promise<{ deleted_count: number }> {
  return request<{ deleted_count: number }>("/api/v1/logs", {
    method: "DELETE",
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

export function getIngestJobEvents(
  id: string,
  limit = 500,
): Promise<IngestJobEventsResponse> {
  return request<IngestJobEventsResponse>(
    `/api/v1/ingest/jobs/${encodeURIComponent(id)}/events?limit=${limit}`,
  )
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

export interface SourceContentResponse {
  content: string
  filename: string
}

export function getSourceContent(id: string): Promise<SourceContentResponse> {
  return request<SourceContentResponse>(
    `/api/v1/ingest/jobs/${encodeURIComponent(id)}/source`,
  )
}

export function getSourceUrl(id: string): string {
  return `/api/v1/ingest/jobs/${encodeURIComponent(id)}/source`
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

function parseSSEPart(part: string, onEvent: SessionStreamHandler) {
  const lines = part.split("\n")
  let event = "message"
  let data = ""
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim()
    if (line.startsWith("data:")) data = line.slice(5).trim()
  }
  if (!data) return
  try {
    onEvent(event, JSON.parse(data))
  } catch {
    onEvent(event, data)
  }
}

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
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() ?? ""
      for (const part of parts) {
        parseSSEPart(part, onEvent)
      }
    }
    if (buffer.trim()) {
      parseSSEPart(buffer, onEvent)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("input stream") || msg.includes("network")) {
      throw new Error(`连接中断：${msg}`)
    }
    throw e instanceof Error ? e : new Error(msg)
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

export function listProviders(): Promise<Provider[]> {
  return request<Provider[]>("/api/v1/providers")
}

export function listProviderModels(providerId: string): Promise<ModelInfo[]> {
  return request<ModelInfo[]>(
    `/api/v1/providers/${encodeURIComponent(providerId)}/models`,
  )
}

export function updateLastModel(
  instanceId: string,
  model: string,
): Promise<{ status: string }> {
  return request<{ status: string }>("/api/v1/settings/last-model", {
    method: "PUT",
    body: JSON.stringify({ instance_id: instanceId, model }),
  })
}

export function createProviderInstance(payload: {
  name: string
  catalog_id: string
  api_key: string
  base_url?: string
}): Promise<{ instance: ProviderInstance }> {
  return request<{ instance: ProviderInstance }>("/api/v1/provider-instances", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function listProviderInstances(): Promise<{ instances: ProviderInstance[] }> {
  return request<{ instances: ProviderInstance[] }>("/api/v1/provider-instances")
}

export function getProviderInstance(
  id: string,
): Promise<{ instance: ProviderInstance }> {
  return request<{ instance: ProviderInstance }>(
    `/api/v1/provider-instances/${encodeURIComponent(id)}`,
  )
}

export function updateProviderInstance(
  id: string,
  payload: {
    name?: string
    catalog_id?: string
    api_key?: string
    base_url?: string
  },
): Promise<{ instance: ProviderInstance }> {
  return request<{ instance: ProviderInstance }>(
    `/api/v1/provider-instances/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  )
}

export function deleteProviderInstance(
  id: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/api/v1/provider-instances/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
}

export function checkProviderInstance(
  id: string,
): Promise<ProviderCheckResult> {
  return request<ProviderCheckResult>(
    `/api/v1/provider-instances/${encodeURIComponent(id)}/check`,
    { method: "POST" },
  )
}

export function checkAllProviderInstances(): Promise<{
  instances: Array<{
    instance_id: string
    name: string
    check: ProviderCheckResult
  }>
}> {
  return request("/api/v1/provider-instances/check", { method: "POST" })
}

export function checkMCPStatus(mcpServersJson?: string): Promise<{
  servers: MCPServerCheckResult[]
}> {
  return request("/api/v1/settings/mcp/check", {
    method: "POST",
    body: JSON.stringify(
      mcpServersJson != null ? { mcp_servers_json: mcpServersJson } : {},
    ),
  })
}

export function listIngestSessions(): Promise<{ sessions: SessionListItem[] }> {
  return request<{ sessions: SessionListItem[] }>("/api/v1/ingest/sessions")
}

export function updateIngestSession(
  id: string,
  patch: { instance_id?: string; model?: string; title?: string },
): Promise<{ session: IngestSession }> {
  return request<{ session: IngestSession }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  )
}

export function deleteIngestSession(
  id: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
}

// Version Control API

export function initVC(): Promise<{
  status: string
  commit_sha?: string
  commit_count: number
}> {
  return request("/api/v1/vcs/init", { method: "POST" })
}

export function getVCStatus(): Promise<VCStatus> {
  return request<VCStatus>("/api/v1/vcs/status")
}

export function disableVC(): Promise<{ status: string; message: string }> {
  return request<{ status: string; message: string }>("/api/v1/vcs/disable", {
    method: "POST",
  })
}

export function getVCLog(limit = 50): Promise<VCLogEntry[]> {
  return request<VCLogEntry[]>(`/api/v1/vcs/log?limit=${limit}`)
}

export function getVCDiff(sha: string): Promise<{ sha: string; diff: string }> {
  return request<{ sha: string; diff: string }>(
    `/api/v1/vcs/diff/${encodeURIComponent(sha)}`,
  )
}

export function createRollback(
  commitSHA: string,
): Promise<{ status: string; job: IngestJob }> {
  return request<{ status: string; job: IngestJob }>(
    "/api/v1/ingest/rollback",
    {
      method: "POST",
      body: JSON.stringify({ commit_sha: commitSHA }),
    },
  )
}
