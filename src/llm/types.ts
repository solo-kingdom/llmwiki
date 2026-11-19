export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Message {
  role: string;
  content?: string;
  reasoning_content?: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown> | null;
}

export interface ChatResult {
  content: string;
  reasoningContent: string;
  toolCalls: ToolCall[];
}

export interface ChatOptions {
  toolChoice?: string;
}

export type StreamEventType = "token" | "done" | "error";

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  error?: Error;
}

export interface LLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  streamIdleTimeoutMs: number;
}

export interface WorkspaceConfig {
  provider: string;
  api_key: string;
  model: string;
  base_url: string;
  request_timeout: number;
  stream_idle_timeout: number;
}

export interface ToolLoopConfig {
  maxRounds: number;
  maxToolCallsPerRound: number;
}

export interface ToolExecutor {
  execute(name: string, argsJson: string): Promise<string>;
  listTools(): Promise<ToolDefinition[]>;
}

export interface EmbeddingSettings {
  instanceId: string;
  model: string;
  dim: number;
}
