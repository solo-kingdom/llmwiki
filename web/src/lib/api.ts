import type {
  Document,
  DocumentListItem,
  SearchResponse,
  Settings,
  WorkspaceRuleFilesPreview,
  ReferenceSummary,
  StalePage,
  KnowledgeGraphResponse,
  IngestJob,
  IngestJobResponse,
  IngestJobEventsResponse,
  UploadIngestResponse,
  CapabilitiesResponse,
  IngestSession,
  IngestSessionMessage,
  ActiveReviewSummary,
  ArchiveSessionResponse,
  WikiRefPayload,
  SessionWikiReference,
  IngestReview,
  IngestReviewPlan,
  Provider,
  ProviderInstance,
  ModelInfo,
  PublicWikiDocument,
  SessionListItem,
  ChangeSet,
  PageRevision,
  HistoryListResponse,
  HistoryDetailResponse,
  PageHistoryResponse,
  RollbackResponse,
  SearchMode,
  ProviderCheckResult,
  MCPServerCheckResult,
  ActivityLog,
  SessionMessageEventsResponse,
  ACPAgent,
  ACPAgentCheckResult,
  AgentKind,
  WorkspaceOverview,
  WikiFolder,
  WikiTreeResponse,
  FolderDeleteMode,
  MoveDocumentResponse,
  MoveFolderResponse,
  DeleteFolderResponse,
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

export function listDocuments(params?: {
  source_kind?: string
  types?: string[]
  exclude_hidden?: boolean
}): Promise<DocumentListItem[]> {
  const q = new URLSearchParams()
  if (params?.source_kind) q.set("source_kind", params.source_kind)
  for (const t of params?.types ?? []) q.append("types", t)
  if (params?.exclude_hidden) q.set("exclude_hidden", "true")
  const qs = q.toString()
  return request<DocumentListItem[]>(
    `/api/v1/documents${qs ? `?${qs}` : ""}`,
  )
}

export function getDocument(id: string): Promise<Document> {
  return request<Document>(`/api/v1/documents/${encodeURIComponent(id)}`)
}

export function getWikiTree(params?: {
  exclude_hidden?: boolean
  types?: string[]
}): Promise<WikiTreeResponse> {
  const q = new URLSearchParams()
  if (params?.exclude_hidden === false) q.set("exclude_hidden", "false")
  for (const t of params?.types ?? []) q.append("types", t)
  const qs = q.toString()
  return request<WikiTreeResponse>(`/api/v1/tree${qs ? `?${qs}` : ""}`)
}

export function createFolder(payload: {
  path: string
  display_name?: string
  description?: string
  sort_order?: number
}): Promise<WikiFolder> {
  return request<WikiFolder>("/api/v1/folders", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateFolder(payload: {
  path: string
  display_name?: string
  description?: string
  sort_order?: number
}): Promise<WikiFolder> {
  return request<WikiFolder>("/api/v1/folders", {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function moveFolder(payload: {
  from_path: string
  to_path: string
}): Promise<MoveFolderResponse> {
  return request<MoveFolderResponse>("/api/v1/folders/move", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function deleteFolder(params: {
  path: string
  mode: FolderDeleteMode
  target_folder?: string
}): Promise<DeleteFolderResponse> {
  const q = new URLSearchParams({ path: params.path, mode: params.mode })
  if (params.target_folder) q.set("target_folder", params.target_folder)
  return request<DeleteFolderResponse>(`/api/v1/folders?${q.toString()}`, {
    method: "DELETE",
  })
}

export function createDocument(payload: {
  filename: string
  path: string
  title?: string
  content?: string
  tags?: string[]
  page_type?: string
}): Promise<Document> {
  return request<Document>("/api/v1/documents", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updateDocumentMetadata(
  id: string,
  payload: { title?: string; tags?: string[]; date?: string; metadata?: string; page_type?: string },
): Promise<Document> {
  return request<Document>(`/api/v1/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function moveDocument(
  id: string,
  payload: { target_folder: string; filename?: string },
): Promise<MoveDocumentResponse> {
  return request<MoveDocumentResponse>(`/api/v1/documents/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function deleteDocument(id: string): Promise<{ status: string; path: string }> {
  return request<{ status: string; path: string }>(`/api/v1/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export function searchDocuments(
  q: string,
  limit = 10,
  types?: string[],
  mode?: SearchMode,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q,
    limit: String(limit),
  })
  for (const t of types ?? []) params.append("types", t)
  if (mode) params.set("mode", mode)
  return request<SearchResponse>(`/api/v1/search?${params.toString()}`)
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
  types?: string[],
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q,
    limit: String(limit),
  })
  for (const t of types ?? []) params.append("types", t)
  return request<SearchResponse>(
    `/api/public/wiki/search?${params.toString()}`,
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

export function getWorkspaceRuleFiles(): Promise<WorkspaceRuleFilesPreview> {
  return request<WorkspaceRuleFilesPreview>("/api/v1/workspace/rule-files")
}

export function updateWorkspaceRuleFiles(payload: {
  purpose?: string
  rules?: string
}): Promise<{ status: string; written: string[] }> {
  return request<{ status: string; written: string[] }>("/api/v1/workspace/rule-files", {
    method: "PUT",
    body: JSON.stringify(payload),
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

export function getKnowledgeGraph(params?: { limit?: number }): Promise<KnowledgeGraphResponse> {
  const qs = new URLSearchParams()
  if (params?.limit) qs.set("limit", String(params.limit))
  const query = qs.toString()
  return request<KnowledgeGraphResponse>("/api/v1/graph" + (query ? `?${query}` : ""))
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
  return request<IngestJob[]>(`/api/v1/ingest/jobs?limit=${limit}`)
}

export function getIngestJob(id: string): Promise<IngestJobResponse> {
  return request<IngestJobResponse>(
    `/api/v1/ingest/jobs/${encodeURIComponent(id)}`,
  )
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

export function createIngestSession(title?: string, mode?: string, agentKind?: AgentKind, acpAgentId?: string): Promise<{ session: IngestSession }> {
  const body: Record<string, string> = { title: title ?? "" }
  if (mode) body.mode = mode
  if (agentKind) body.agent_kind = agentKind
  if (acpAgentId) body.acp_agent_id = acpAgentId
  return request<{ session: IngestSession }>("/api/v1/ingest/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function updateSessionMode(id: string, mode: string): Promise<{ session: IngestSession }> {
  return request<{ session: IngestSession }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    },
  )
}

export function getIngestSession(id: string): Promise<{
  session: IngestSession
  active_review?: ActiveReviewSummary | null
}> {
  return request<{
    session: IngestSession
    active_review?: ActiveReviewSummary | null
  }>(
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

export function getSessionMessageEvents(
  sessionId: string,
  messageId: string,
  limit = 200,
): Promise<SessionMessageEventsResponse> {
  return request<SessionMessageEventsResponse>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}` +
      `/messages/${encodeURIComponent(messageId)}/events?limit=${limit}`,
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

async function consumeSessionSSE(
  res: Response,
  onEvent: SessionStreamHandler,
): Promise<void> {
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
      throw new Error(`__i18n:error.connection_interrupted:${msg}`, { cause: e })
    }
    throw e instanceof Error ? e : new Error(msg)
  }
}

export async function streamIngestSessionMessage(
  sessionId: string,
  content: string,
  onEvent: SessionStreamHandler,
  wikiRefs?: WikiRefPayload[],
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/messages?stream=1`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ content, wiki_refs: wikiRefs ?? [] }),
      ...(signal !== undefined ? { signal } : {}),
    },
  )
  await consumeSessionSSE(res, onEvent)
}

export function listIngestSessionReferences(
  sessionId: string,
): Promise<{ references: SessionWikiReference[] }> {
  return request<{ references: SessionWikiReference[] }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/references`,
  )
}

export async function streamRetryIngestSessionMessage(
  sessionId: string,
  assistantMessageId: string,
  onEvent: SessionStreamHandler,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(assistantMessageId)}/retry?stream=1`,
    {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      ...(signal !== undefined ? { signal } : {}),
    },
  )
  await consumeSessionSSE(res, onEvent)
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

export function patchIngestSessionMessage(
  sessionId: string,
  messageId: string,
  patch: { exclude_from_archive?: boolean },
): Promise<{ message: IngestSessionMessage }> {
  return request<{ message: IngestSessionMessage }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  )
}

export function archiveIngestSession(
  sessionId: string,
  title?: string,
  deepOrganize?: boolean,
): Promise<ArchiveSessionResponse> {
  return request<ArchiveSessionResponse>(
    `/api/v1/ingest/sessions/${encodeURIComponent(sessionId)}/archive`,
    {
      method: "POST",
      body: JSON.stringify({
        title: title ?? "",
        ...(deepOrganize != null ? { deep_organize: deepOrganize } : {}),
      }),
    },
  )
}

export function listIngestReviews(): Promise<IngestReview[]> {
  return request<{ reviews: IngestReview[] }>("/api/v1/ingest/reviews").then(
    (r) => r.reviews ?? [],
  )
}

export function getIngestReview(id: string): Promise<IngestReview> {
  return request<{ review: IngestReview }>(
    `/api/v1/ingest/reviews/${encodeURIComponent(id)}`,
  ).then((r) => r.review)
}

export function listIngestReviewPlans(
  reviewId: string,
): Promise<IngestReviewPlan[]> {
  return request<{ plans: IngestReviewPlan[] }>(
    `/api/v1/ingest/reviews/${encodeURIComponent(reviewId)}/plans`,
  ).then((r) => r.plans ?? [])
}

export function addIngestReviewFeedback(
  reviewId: string,
  content: string,
): Promise<void> {
  return request(
    `/api/v1/ingest/reviews/${encodeURIComponent(reviewId)}/feedback`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  )
}

export function replanIngestReview(reviewId: string): Promise<void> {
  return request(
    `/api/v1/ingest/reviews/${encodeURIComponent(reviewId)}/replan`,
    { method: "POST" },
  )
}

export function approveIngestReview(reviewId: string): Promise<void> {
  return request(
    `/api/v1/ingest/reviews/${encodeURIComponent(reviewId)}/approve`,
    { method: "POST" },
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
  patch: { instance_id?: string; model?: string; title?: string; agent_kind?: AgentKind; acp_agent_id?: string },
): Promise<{ session: IngestSession }> {
  return request<{ session: IngestSession }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  )
}

export function listACPAgents(): Promise<{ agents: ACPAgent[]; config_error?: string }> {
  return request<{ agents: ACPAgent[]; config_error?: string }>("/api/v1/acp-agents")
}

export function checkACPAgents(acpAgentsJson?: string): Promise<{ agents: ACPAgentCheckResult[] }> {
  return request<{ agents: ACPAgentCheckResult[] }>("/api/v1/acp-agents/check", {
    method: "POST",
    ...(acpAgentsJson === undefined ? {} : { body: JSON.stringify({ acp_agents_json: acpAgentsJson }) }),
  })
}

export function deleteIngestSession(
  id: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/api/v1/ingest/sessions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
}

// Revision history API (PostgreSQL-backed change sets)

export function listHistory(
  limit = 50,
  before?: string,
): Promise<HistoryListResponse> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set("before", before)
  return request<HistoryListResponse>(`/api/v1/history?${params.toString()}`)
}

export function getHistory(id: string): Promise<HistoryDetailResponse> {
  return request<HistoryDetailResponse>(
    `/api/v1/history/${encodeURIComponent(id)}`,
  )
}

export function getHistoryDiff(id: string): Promise<{ diff: string }> {
  return request<{ diff: string }>(
    `/api/v1/history/${encodeURIComponent(id)}/diff`,
  )
}

export function rollbackHistory(id: string): Promise<RollbackResponse> {
  return request<RollbackResponse>(
    `/api/v1/history/${encodeURIComponent(id)}/rollback`,
    { method: "POST" },
  )
}

export function rollbackChangeSet(
  changeSetId: string,
): Promise<RollbackResponse> {
  return request<RollbackResponse>("/api/v1/ingest/rollback", {
    method: "POST",
    body: JSON.stringify({ change_set_id: changeSetId }),
  })
}

export function listPageHistory(
  path: string,
  limit = 100,
): Promise<PageHistoryResponse> {
  const params = new URLSearchParams({ path, limit: String(limit) })
  return request<PageHistoryResponse>(
    `/api/v1/pages/history?${params.toString()}`,
  )
}

export function getRevision(id: string): Promise<PageRevision> {
  return request<PageRevision>(`/api/v1/revisions/${encodeURIComponent(id)}`)
}

export function restoreRevision(id: string): Promise<ChangeSet> {
  return request<ChangeSet>(
    `/api/v1/revisions/${encodeURIComponent(id)}/restore`,
    { method: "POST" },
  )
}

export function getWorkspace(): Promise<WorkspaceOverview> {
  return request<WorkspaceOverview>("/api/v1/workspace")
}
