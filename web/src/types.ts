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
}

export interface DocumentListItem {
  id: string
  filename: string
  title: string
  path: string
  file_type: string
  page_count: number
  updated_at: string
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
}

export interface SearchResponse {
  query: string
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

export interface SessionListItem {
  id: string
  title: string
  status: "active" | "archived"
  llm_instance_id: string
  llm_model: string
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
  mcp_servers_json?: string
  ui_language: string
  doc_language: string
  rules_supplement?: string
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

export interface IngestSession {
  id: string
  title: string
  status: "active" | "archived"
  storage_path: string
  llm_instance_id: string
  llm_model: string
  created_at: string
  updated_at: string
}

export interface IngestSessionMessage {
  id: string
  session_id: string
  role: "user" | "assistant" | "system"
  content: string
  message_type: "text" | "attachment_summary"
  attachment_id: string
  stream_status: "streaming" | "complete" | "incomplete" | "failed"
  /** Populated when stream_status is failed (from SSE error or client-side stream failure). */
  error_message?: string
  created_at: string
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

export interface VCStatus {
  enabled: boolean
  commit_count: number
  git_available: boolean
  git_version: string
  tracked_dirs: string[]
  excluded_dirs: string[]
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

export interface VCLogEntry {
  sha: string
  subject: string
  timestamp: string
  files_changed: number
  is_rollback: boolean
}
