export const DEFAULT_SERVER_URL = "http://localhost:8868"
export const STORAGE_KEY_SERVER_URL = "llmwiki_server_url"

export interface ClipPayload {
  title: string
  content: string
  sourceRef: string
  filename: string
}

export interface IngestJob {
  id: string
  status: string
  source_path: string
  source_ref: string
}

export interface IngestJobResponse {
  job: IngestJob
}

export interface ExtractedPage {
  title: string
  url: string
  content: string
}

export type Message =
  | { type: "EXTRACT_PAGE" }
  | { type: "EXTRACTED_PAGE"; payload: ExtractedPage }
  | { type: "EXTRACT_ERROR"; error: string }
  | { type: "SUBMIT_CLIP"; payload: ClipPayload }
  | { type: "SUBMIT_RESULT"; payload: IngestJobResponse }
  | { type: "SUBMIT_ERROR"; error: string }
