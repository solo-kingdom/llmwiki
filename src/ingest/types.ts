import type { Client } from "../llm/client.js";

export type InputKind = "conversation" | "text" | "upload" | "session_archive" | "review_plan" | "review_apply";

export const INPUT_KIND_CONVERSATION: InputKind = "conversation";
export const INPUT_KIND_TEXT: InputKind = "text";
export const INPUT_KIND_UPLOAD: InputKind = "upload";
export const INPUT_KIND_SESSION_ARCHIVE: InputKind = "session_archive";
export const INPUT_KIND_REVIEW_PLAN: InputKind = "review_plan";
export const INPUT_KIND_REVIEW_APPLY: InputKind = "review_apply";

export interface NormalizedSource {
  kind: InputKind;
  canonicalPath: string;
  originalName: string;
  sourceRef: string;
  title?: string;
  content: Uint8Array;
}

export interface CacheEntry {
  source_name: string;
  sha256: string;
  content_sha256?: string;
  written_files: string[];
}

export interface CacheFile {
  entries: Record<string, CacheEntry>;
}

export interface ApplyWikiResult {
  written: string[];
  deleted: string[];
}

export interface MergeContext {
  llmClient: Client | null;
  docLang: string;
  recorder: JobRecorder | null;
}

export interface ApplyWikiBlocksOptions {
  forceOverwrite: boolean;
  unlockTypeAndTitle?: boolean;
  merge: MergeContext | null;
}

export interface JobRecorder {
  record(step: string, phase: string, message: string, payload: Record<string, unknown> | null): void;
}

export interface PlanResult {
  planMarkdown: string;
  planJson: string;
}

export interface PlanAction {
  action: string;
  path: string;
  from_path?: string;
  to_path?: string;
  source_paths?: string[];
  rationale?: string;
}

export interface WikiRefInput {
  documentId: string;
  relativePath: string;
  title: string;
}

export interface WikiPageBody {
  documentId: string;
  relativePath: string;
  title: string;
  content: string;
}

export interface Section {
  heading: string;
  content: string;
}

export interface SectionDiff {
  type: "unchanged" | "modified" | "new" | "deleted";
  old: Section | null;
  new: Section | null;
  similarity: number;
}

export interface RelatedSubsetEntry {
  relativePath: string;
  title: string;
  score: number;
}

export interface SessionArchiveReference {
  path: string;
  title: string;
  source: string;
}

export interface SessionArchiveMessage {
  role: string;
  content: string;
  messageType: string;
  attachmentPath: string;
}

export interface RuleFilesPreview {
  purpose: string;
  rules: string;
  purpose_preview: string;
  rules_preview: string;
}

export interface WikiRefRequest {
  document_id: string;
  relative_path: string;
}

export interface PromptContext {
  workspace?: string;
  docLang: string;
  rulesSupplement: string;
  workspacePurpose?: string;
  workspaceRules?: string;
  stepAppends?: Record<string, string>;
}

export type PromptStep =
  | "analysis"
  | "generation"
  | "plan"
  | "session_chat"
  | "session_qa"
  | "session_organize"
  | "merge_body"
  | "plan_organize"
  | "plan_qa";
