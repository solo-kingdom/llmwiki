export interface Document {
  id: string
  user_id: string
  filename: string
  title: string
  path: string
  relative_path: string
  source_kind: string
  file_type: string
  file_size: number
  document_number: number
  status: string
  page_count: number
  content: string
  tags: string[] | null
  date: string
  metadata: string
  error_message: string
  version: number
  parser: string
  content_hash: string
  stale_since: string
  highlights: string
  created_at: string
  updated_at: string
  reference_entries?: ReferenceEntry[]
  wikilinks?: Wikilink[]
}

export interface DocumentListItem {
  id: string
  filename: string
  title: string
  path: string
  relative_path?: string
  source_kind?: string
  page_type?: string
  file_type: string
  page_count: number
  updated_at: string
}

export interface WikiFolder {
  path: string
  display_name: string
  description: string
  sort_order: number
  created_at: string
  updated_at: string
  direct_count: number
  total_count: number
}

export interface WikiTreeResponse {
  folders: WikiFolder[]
  documents: DocumentListItem[]
}

export type FolderDeleteMode = "empty" | "move_to_parent" | "cascade"

export interface MoveDocumentResponse {
  document: Document
  old_relative_path: string
  change_set_id: string
  updated_link_count: number
}

export interface MoveFolderResponse {
  from_path: string
  to_path: string
  moved_folders: number
  moved_documents: number
  moved_doc_paths: string[]
  change_set_id: string
  updated_link_paths: string[]
}

export interface DeleteFolderResponse {
  path: string
  mode: FolderDeleteMode
  deleted_folders: number
  moved_documents: number
  deleted_documents: number
  change_set_id: string
}

/** Structured reference entry from document_reference_entries (trailing
 * 相关/来源 sections extracted server-side). */
export interface ReferenceEntry {
  kind: "related" | "source"
  raw_text: string
  target_document_id: string
  annotation: string
  target_title: string
}

/** Server-resolved inline [[..]] map returned with document payloads. */
export interface Wikilink {
  text: string
  doc_id: string
  title: string
}

/** Public read-only document payload from /api/public/wiki/documents/{id} */
export interface PublicWikiDocument {
  id: string
  filename: string
  title: string
  path: string
  file_type: string
  page_count: number
  updated_at: string
  content: string
  tags: string[]
  reference_entries?: ReferenceEntry[]
  wikilinks?: Wikilink[]
}

export interface SearchChunk {
  document_id: string
  content: string
  page: number
  header_breadcrumb: string
  chunk_index: number
  filename: string
  title: string
  path: string
  file_type: string
  score: number
  match_type?: "keyword" | "semantic"
}

export type SearchMode = "keyword" | "semantic" | "hybrid"

export interface SearchResponse {
  query: string
  mode?: SearchMode
  results: SearchChunk[]
}

export interface Provider {
  id: string
  name: string
  api_base: string
  api_format: string
  env_key: string
  doc_url: string
}

export interface ProviderInstance {
  id: string
  name: string
  catalog_id: string
  api_key_masked: string
  base_url: string
  created_at: string
  updated_at: string
}

export interface ModelInfo {
  provider_id: string
  model_id: string
  name: string
  family: string
  context_limit: number
  output_limit: number
  cost_input: number
  cost_output: number
  reasoning: boolean
  tool_call: boolean
  attachment: boolean
}

export type AgentKind = "native" | "acp"

export interface ACPAgentEnvVar {
  name: string
  present: boolean
}

export interface ACPAgent {
  id: string
  name: string
  enabled: boolean
  command: string
  args: string[]
  cwd_policy: string
  permission: {
    mode: string
    allow_read: boolean
    allow_search: boolean
    allow_fetch: boolean
    allow_write: boolean
    allow_execute: boolean
  }
  env_passthrough: ACPAgentEnvVar[]
  available: boolean
  unavailable_reason?: string
}

export interface ACPAgentCheckResult {
  id: string
  name: string
  enabled: boolean
  status: "ok" | "error" | "disabled"
  code?: string
  message?: string
  agent_name?: string
  agent_version?: string
  protocol_version?: number
}

export interface SessionListItem {
  id: string
  title: string
  status: "active" | "archived"
  llm_instance_id: string
  llm_model: string
  mode?: string
  agent_kind?: AgentKind
  acp_agent_id?: string
  created_at: string
  updated_at: string
}

export interface Settings {
  last_instance_id: string
  last_model: string
  job_instance_id: string
  job_model: string
  max_tokens: number
  api_key: string
  temperature: number
  chunk_size: number
  chunk_overlap: number
  auto_reindex: boolean
  watch_sources: boolean
  activity_logs_max_count?: number
  ingest_job_events_max_count?: number
  session_message_events_max_count?: number
  mcp_servers_json?: string
  ui_language: string
  doc_language: string
  rules_supplement?: string
  session_tool_loop_max_rounds_ingest?: number
  session_tool_loop_max_rounds_qa?: number
  session_tool_loop_max_rounds_organize?: number
  session_tool_loop_max_calls_per_round?: number
  embedding_instance_id?: string
  embedding_model?: string
  embedding_dim?: string | number
  embedding_configured?: boolean
  acp_agents_json?: string
  default_agent_kind?: AgentKind
  default_acp_agent_id?: string
  acp_max_concurrent_agents?: string | number
  // Write-only: the server never returns the token, only its mask and where it comes from.
  api_token?: string
  api_token_set?: boolean
  api_token_masked?: string
  api_token_source?: "flag" | "settings" | "none"
}

export interface WorkspaceRuleFilesPreview {
  purpose_preview: string
  rules_preview: string
  purpose_mtime?: number
  rules_mtime?: number
}

export interface ActivityLog {
  id: number
  created_at: string
  level: string
  category: string
  action: string
  message: string
  resource_type: string
  resource_id: string
  status: string
  details: string
  source: string
}

export interface ReferenceSummary {
  path: string
  filename: string
  title: string
  reference_type: string
  page: number
}

export interface GraphNode {
  id: string
  document_id: string
  title: string
  type: string
  link_count: number
}

export interface GraphEdge {
  source: string
  target: string
  type: string
}

export interface KnowledgeGraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  total_nodes: number
  truncated: boolean
}

export interface StalePage {
  filename: string
  title: string
  path: string
  stale_since: string
}

export interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
  doc?: DocumentListItem
}

export interface IngestJob {
  id: string
  parent_job_id: string
  input_type: string
  source_path: string
  source_ref: string
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  retries: number
  max_retries: number
  error: string
  error_code: string
  error_message: string
  missing_dependency: string
  remediation: string
  result_summary: string
  created_at: string
  updated_at: string
}

export interface IngestJobResponse {
  job: IngestJob
}

export interface IngestJobEvent {
  id: number
  job_id: string
  step: string
  phase: string
  message: string
  payload: string
  created_at: string
}

export interface IngestJobEventsResponse {
  events: IngestJobEvent[]
}

export interface UploadAcceptedItem {
  filename: string
  job_id: string
  status: string
  source_path: string
}

export interface UploadRejectedItem {
  filename: string
  error_code: string
  message: string
  remediation?: string
}

export interface UploadIngestResponse {
  accepted: UploadAcceptedItem[]
  rejected: UploadRejectedItem[]
}

export interface RuntimeDependency {
  name: string
  found: boolean
  purpose: string
}

export interface FileTypeCapability {
  extension: string
  mime_type: string
  tier: string
  can_extract: boolean
  can_chunk: boolean
  missing_deps?: string[]
  remediation?: string
}

export interface CapabilitiesResponse {
  file_types: FileTypeCapability[]
  runtime_dependencies: RuntimeDependency[]
  access_model: string
}

export interface ActiveReviewSummary {
  review_id: string
  status: IngestReview["status"]
  current_plan_version: number
  change_set_id?: string
}

export interface IngestSession {
  id: string
  title: string
  mode: string
  status: "active" | "archived"
  storage_path: string
  llm_instance_id: string
  llm_model: string
  agent_kind?: AgentKind
  acp_agent_id?: string
  created_at: string
  updated_at: string
}

export interface WikiRefPayload {
  document_id: string
  relative_path: string
  title: string
}

export interface IngestSessionMessage {
  id: string
  session_id: string
  role: "user" | "assistant" | "system"
  content: string
  message_type: "text" | "attachment_summary"
  attachment_id: string
  stream_status: "streaming" | "complete" | "incomplete" | "failed"
  wiki_refs_json?: string
  exclude_from_archive?: boolean
  /** Populated when stream_status is failed (from SSE error or client-side stream failure). */
  error_message?: string
  /** Client-side warning during streaming (e.g. tool loop fallback). */
  warning_message?: string
  /** Client-side parsed wiki refs for display. */
  wiki_refs?: WikiRefPayload[]
  /** Client-side tool activity during streaming. */
  tool_status?: string | null
  tool_reads?: string[]
  thought_text?: string
  plan_entries?: ACPPlanEntry[]
  created_at: string
}

export interface ACPPlanEntry {
  content: string
  priority?: string
  status: string
}

export interface SessionWikiReference {
  id: string
  session_id: string
  document_id: string
  relative_path: string
  title: string
  source: "user_mention" | "tool_read"
  first_seen_at: string
}

export interface ArchiveSessionResponse {
  review_id: string
  status: string
  source_path: string
  session_id: string
  plan_job_id?: string
}

export interface IngestReview {
  id: string
  session_id: string
  archive_source_path: string
  status:
    | "planning"
    | "ready_for_review"
    | "revising"
    | "approved"
    | "applying"
    | "succeeded"
    | "failed"
    | "cancelled"
  current_plan_version: number
  approved_plan_version: number
  final_job_id?: string
  change_set_id?: string
  created_at: string
  updated_at: string
}

export interface IngestReviewPlan {
  id: string
  review_id: string
  version: number
  plan_markdown: string
  plan_json: string
  created_at: string
}

export interface OutlineItem {
  level: number
  text: string
  slug: string
}

/** One atomic write operation recorded in PostgreSQL revision history. */
export interface ChangeSet {
  id: string
  kind: string
  job_id?: string
  review_id?: string
  source_blob_id?: string
  source_filename?: string
  summary?: string
  rollback_of?: string
  page_count: number
  created_at: string
}

export type RevisionOperation = "create" | "update" | "delete" | "restore"

/** Immutable snapshot of one page within a change set. */
export interface PageRevision {
  id: string
  document_id?: string
  relative_path: string
  revision_no: number
  parent_revision_id?: string
  change_set_id: string
  operation: RevisionOperation
  title: string
  content: string
  metadata: string
  content_hash: string
  source_kind: string
  file_type: string
  actor: string
  created_at: string
}

export interface HistoryListResponse {
  changes: ChangeSet[]
}

export interface HistoryDetailResponse {
  change_set: ChangeSet
  pages: PageRevision[]
}

export interface PageHistoryResponse {
  path: string
  revisions: PageRevision[]
}

export interface RollbackResponse {
  status: string
  job_id: string
}

export interface ProviderCheckResult {
  status: "ok" | "error"
  message: string
  details: {
    has_api_key: boolean
    has_base_url: boolean
    reachable: boolean
    catalog_id: string
  }
}

export interface MCPServerCheckResult {
  id: string
  name: string
  enabled: boolean
  status: "ok" | "error" | "disabled"
  message?: string
  tool_count?: number
}

export interface SessionMessageEvent {
  id: number
  message_id: string
  step: string
  phase: string
  message: string
  payload: string
  created_at: string
}

export interface SessionMessageEventsResponse {
  events: SessionMessageEvent[]
}

export interface WorkspaceLayoutFlags {
  purpose: boolean
  rules: boolean
  wiki: boolean
  raw_sources: boolean
  index_db: boolean
}

export interface WorkspaceCounts {
  documents: number
  wiki_pages: number
  sources: number
}

export interface WorkspaceDir {
  dir: string
  count: number
}

export interface WorkspaceOverview {
  root: string
  layout: WorkspaceLayoutFlags
  counts: WorkspaceCounts
  page_types: Record<string, number>
  wiki_dirs: WorkspaceDir[]
  last_updated?: string
}
