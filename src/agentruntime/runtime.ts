import type { IngestSession, IngestSessionMessage } from "../store/types.js";

export const KIND_NATIVE = "native";
export const KIND_ACP = "acp";

export type AgentRuntimeErrorCode =
  | "no_provider_instance"
  | "no_acp_agent"
  | "acp_agent_disabled"
  | "acp_cli_not_found"
  | "acp_config_invalid";

export const ERR_NO_PROVIDER_INSTANCE: AgentRuntimeErrorCode = "no_provider_instance";
export const ERR_NO_ACP_AGENT: AgentRuntimeErrorCode = "no_acp_agent";
export const ERR_ACP_AGENT_DISABLED: AgentRuntimeErrorCode = "acp_agent_disabled";
export const ERR_ACP_CLI_NOT_FOUND: AgentRuntimeErrorCode = "acp_cli_not_found";
export const ERR_ACP_CONFIG_INVALID: AgentRuntimeErrorCode = "acp_config_invalid";

export class AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode;

  constructor(code: AgentRuntimeErrorCode, message: string) {
    super(message);
    this.name = "AgentRuntimeError";
    this.code = code;
  }
}

export function isAgentRuntimeError(
  error: unknown,
  code?: AgentRuntimeErrorCode,
): error is AgentRuntimeError {
  return error instanceof AgentRuntimeError && (code === undefined || error.code === code);
}

export interface WikiRefInput {
  documentId: string;
  relativePath: string;
  title: string;
}

export interface PlanEntry {
  content: string;
  priority: string;
  status: string;
}

export interface PermissionDecision {
  outcome: string;
  optionId: string;
  allowed: boolean;
  reason: string;
  toolKind: string;
  toolTitle: string;
}

export interface SessionMessageRecorderPort {
  record(step: string, phase: string, message: string, payload: Record<string, unknown>): void;
}

export interface EventSink {
  token(text: string): void;
  thought(text: string): void;
  toolStart(name: string, detail: string): void;
  toolDone(name: string, detail: string): void;
  plan(entries: PlanEntry[]): void;
  permission(decision: PermissionDecision): void;
  warning(code: string, message: string): void;
  debug(step: string, phase: string, message: string, payload: Record<string, unknown>): void;
}

export interface PromptRequest {
  sessionId: string;
  mode: string;
  docLang: string;
  userContent: string;
  displayUserContent: string;
  history: IngestSessionMessage[];
  wikiRefs: WikiRefInput[];
  recorder: SessionMessageRecorderPort | null;
}

export interface PromptResult {
  text: string;
  stopReason: string;
}

export interface Runtime {
  kind(): string;
  label(): string;
  prompt(request: PromptRequest, sink: EventSink, signal?: AbortSignal): Promise<PromptResult>;
}

export type { IngestSession };
