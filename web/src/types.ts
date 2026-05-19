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
  tags: string[]
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

export interface SearchChunk {
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

export interface Settings {
  llm_provider: string
  llm_model: string
  max_tokens: number
  api_key: string
  temperature: number
  chunk_size: number
  chunk_overlap: number
  auto_reindex: boolean
  watch_sources: boolean
}

export interface ReferenceSummary {
  path: string
  filename: string
  title: string
  reference_type: string
  page: number
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
