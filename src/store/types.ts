export const SESSION_REF_SOURCE_USER_MENTION = "user_mention";
export const SESSION_REF_SOURCE_TOOL_READ = "tool_read";

export const DEFAULT_JOB_EVENTS_MAX_COUNT = 200;
export const MIN_JOB_EVENTS_MAX_COUNT = 50;
export const MAX_JOB_EVENTS_MAX_COUNT = 2000;

export const DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT = 100;
export const MIN_SESSION_MSG_EVENTS_MAX_COUNT = 10;
export const MAX_SESSION_MSG_EVENTS_MAX_COUNT = 500;

export const DEFAULT_MAX_CONCURRENT_JOBS = 3;
export const STALE_HEARTBEAT_SECONDS = 120;

export interface Document {
  id: string;
  user_id: string;
  filename: string;
  title: string;
  path: string;
  relative_path: string;
  source_kind: string;
  file_type: string;
  file_size: number;
  document_number: number;
  status: string;
  page_count: number;
  content: string;
  tags: string[];
  date: string;
  metadata: string;
  error_message: string;
  version: number;
  parser: string;
  content_hash: string;
  stale_since: string;
  highlights: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  page_type?: string;
  confidence?: string;
  page_status?: string;
  experience_kind?: string;
  last_verified?: string;
  review_after?: string;
  archived_at?: string;
  archive_reason?: string;
  superseded_by?: string;
  aliases?: string[];
  symptoms?: string[];
}

export type ArchiveFilter = "exclude" | "include" | "only";

export interface ListDocumentsFilter {
  source_kind?: string;
  page_types?: string[];
  exclude_hidden?: boolean;
  experience_kinds?: string[];
  statuses?: string[];
  confidences?: string[];
  archived?: ArchiveFilter;
  review_overdue?: boolean;
  today?: string;
}

export interface SearchOptions {
  page_types?: string[];
  experience_kinds?: string[];
  statuses?: string[];
  confidences?: string[];
  archived?: ArchiveFilter;
  review_overdue?: boolean;
  today?: string;
}

export interface Chunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page: number;
  start_char: number;
  token_count: number;
  header_breadcrumb: string;
}

export interface SearchChunk {
  document_id: string;
  content: string;
  page: number;
  header_breadcrumb: string;
  chunk_index: number;
  filename: string;
  title: string;
  path: string;
  file_type: string;
  page_type?: string;
  score: number;
  match_type?: string;
  confidence?: string;
  page_status?: string;
  experience_kind?: string;
  last_verified?: string;
  review_after?: string;
  archived_at?: string;
  symptoms?: string[];
}

export interface Reference {
  source_document_id: string;
  target_document_id: string;
  reference_type: string;
  page: number;
}

export interface ReferenceSummary {
  path: string;
  filename: string;
  title: string;
  reference_type: string;
  page: number;
}

export interface ReferenceEntryInput {
  kind: "related" | "source";
  rawText: string;
  targetDocumentId: string;
  annotation: string;
  position: number;
}

export interface ReferenceEntryView {
  kind: "related" | "source";
  rawText: string;
  targetDocumentId: string;
  annotation: string;
  position: number;
  targetTitle: string;
  targetPath: string;
  targetFilename: string;
}

export interface StalePage {
  filename: string;
  title: string;
  path: string;
  stale_since: string;
}

export interface UncitedSource {
  filename: string;
  title: string;
  path: string;
  file_type: string;
}

export interface RefEdge {
  source_id: string;
  target_id: string;
  ref_type: string;
  page: number | null;
}

export interface GraphNode {
  id: string;
  document_id: string;
  title: string;
  type: string;
  link_count: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_nodes: number;
  truncated: boolean;
}

export interface IngestJob {
  id: string;
  parent_job_id: string;
  input_type: string;
  source_path: string;
  source_ref: string;
  status: string;
  retries: number;
  max_retries: number;
  error: string;
  error_code: string;
  error_message: string;
  missing_dependency: string;
  remediation: string;
  result_summary: string;
  runner_id?: string;
  heartbeat_at?: string;
  created_at: string;
  updated_at: string;
}

export interface IngestJobEvent {
  id: number;
  job_id: string;
  step: string;
  phase: string;
  message: string;
  payload: string;
  created_at: string;
}

export interface IngestSession {
  id: string;
  title: string;
  status: string;
  storage_path: string;
  llm_instance_id: string;
  llm_model: string;
  mode: string;
  agent_kind: string;
  acp_agent_id: string;
  created_at: string;
  updated_at: string;
}

export interface IngestSessionMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  message_type: string;
  attachment_id: string;
  stream_status: string;
  wiki_refs_json?: string;
  exclude_from_archive: boolean;
  created_at: string;
}

export interface IngestSessionReference {
  id: string;
  session_id: string;
  document_id: string;
  relative_path: string;
  title: string;
  source: string;
  first_seen_at: string;
}

export interface SessionMessageEvent {
  id: number;
  message_id: string;
  step: string;
  phase: string;
  message: string;
  payload: string;
  created_at: string;
}

export interface IngestReview {
  id: string;
  session_id: string;
  archive_source_path: string;
  status: string;
  current_plan_version: number;
  approved_plan_version: number;
  final_job_id?: string;
  change_set_id?: string;
  created_at: string;
  updated_at: string;
  deep_organize: boolean;
}

export interface ActiveReviewSummary {
  review_id: string;
  status: string;
  current_plan_version: number;
  change_set_id?: string;
}

export interface IngestReviewMessage {
  id: string;
  review_id: string;
  role: string;
  message_type: string;
  content: string;
  created_at: string;
}

export interface IngestReviewPlan {
  id: string;
  review_id: string;
  version: number;
  plan_markdown: string;
  plan_json: string;
  created_at: string;
}

export interface ActivityLog {
  id: number;
  created_at: string;
  level: string;
  category: string;
  action: string;
  message: string;
  resource_type: string;
  resource_id: string;
  status: string;
  details: string;
  source: string;
}

export interface ActivityLogListFilter {
  limit: number;
  offset: number;
  category: string;
  level: string;
}

export interface ProviderInstance {
  id: string;
  name: string;
  catalog_id: string;
  api_key: string;
  api_key_masked?: string;
  base_url: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  api_base: string;
  api_format: string;
  env_key: string;
  doc_url: string;
}

export interface ModelInfo {
  provider_id: string;
  model_id: string;
  name: string;
  family: string;
  context_limit: number;
  output_limit: number;
  cost_input: number;
  cost_output: number;
  reasoning: boolean;
  tool_call: boolean;
  attachment: boolean;
  modalities: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  user_id: string;
  created_at: string;
}

export interface SourceBlob {
  id: string;
  document_id: string;
  filename: string;
  media_type: string;
  size: number;
  sha256: string;
  created_at: string;
}

export interface ChangeSet {
  id: string;
  kind: string;
  job_id?: string;
  review_id?: string;
  source_blob_id?: string;
  source_filename?: string;
  normalized_content?: string;
  summary?: string;
  rollback_of?: string;
  page_count: number;
  created_at: string;
}

export type RevisionOperation = "create" | "update" | "delete" | "restore" | "move" | "archive" | "reopen";

export interface WikiFolder {
  path: string;
  display_name: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WikiFolderWithCounts extends WikiFolder {
  direct_count: number;
  total_count: number;
}

export type FolderDeleteMode = "empty" | "move_to_parent" | "cascade";

export interface MoveDocumentResult {
  document: Document;
  old_relative_path: string;
  change_set_id: string;
  updated_link_paths: string[];
}

export interface MoveFolderResult {
  from_path: string;
  to_path: string;
  moved_folders: number;
  moved_documents: number;
  moved_doc_paths: string[];
  change_set_id: string;
  updated_link_paths: string[];
}

export interface DeleteFolderResult {
  path: string;
  mode: FolderDeleteMode;
  deleted_folders: number;
  moved_documents: number;
  deleted_documents: number;
  change_set_id: string;
}

export interface PageRevision {
  id: string;
  document_id?: string;
  relative_path: string;
  revision_no: number;
  parent_revision_id?: string;
  change_set_id: string;
  operation: RevisionOperation;
  title: string;
  content: string;
  metadata: string;
  content_hash: string;
  source_kind: string;
  file_type: string;
  actor: string;
  created_at: string;
}

export interface ChunkEmbedding {
  chunk_id: string;
  model: string;
  dim: number;
  embedding: number[];
}

export interface PageWrite {
  relative_path: string;
  document: Document | null;
  operation: RevisionOperation;
  chunks: Chunk[];
  refs: RefEdge[];
}

export const CONFIG_API_TOKEN = "api_token";

export const API_KEY_PREFIX = "llmwiki_sk_";
export const MAX_API_KEYS = 20;

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export const ACTIVE_INGEST_REVIEW_STATUSES = new Set([
  "planning",
  "ready_for_review",
  "revising",
  "approved",
  "applying",
]);

export function isActiveIngestReviewStatus(status: string): boolean {
  return ACTIVE_INGEST_REVIEW_STATUSES.has(status.trim());
}

export function activeReviewSummaryFromReview(review: IngestReview | null): ActiveReviewSummary | null {
  if (!review || !review.id || review.status === "cancelled") return null;
  return {
    review_id: review.id,
    status: review.status,
    current_plan_version: review.current_plan_version,
    change_set_id: review.change_set_id,
  };
}

export function parseJobEventsMaxCount(raw: string): number {
  const value = raw.trim();
  if (!value) return DEFAULT_JOB_EVENTS_MAX_COUNT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ingest_job_events_max_count: "${raw}"`);
  }
  if (parsed < MIN_JOB_EVENTS_MAX_COUNT || parsed > MAX_JOB_EVENTS_MAX_COUNT) {
    throw new Error(
      `ingest_job_events_max_count must be between ${MIN_JOB_EVENTS_MAX_COUNT} and ${MAX_JOB_EVENTS_MAX_COUNT}`,
    );
  }
  return parsed;
}

export function parseSessionMsgEventsMaxCount(raw: string): number {
  const value = raw.trim();
  if (!value) return DEFAULT_SESSION_MSG_EVENTS_MAX_COUNT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid session_message_events_max_count: "${raw}"`);
  }
  if (parsed < MIN_SESSION_MSG_EVENTS_MAX_COUNT || parsed > MAX_SESSION_MSG_EVENTS_MAX_COUNT) {
    throw new Error(
      `session_message_events_max_count must be between ${MIN_SESSION_MSG_EVENTS_MAX_COUNT} and ${MAX_SESSION_MSG_EVENTS_MAX_COUNT}`,
    );
  }
  return parsed;
}
