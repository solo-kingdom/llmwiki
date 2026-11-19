import type { Message, ToolDefinition, ToolExecutor, ToolLoopConfig } from "../llm/types.js";
import { logger } from "../logger.js";
import { isWriteToolName } from "../mcp/config.js";
import {
  builtinToolDefinitionsForMode,
  executeLocalReadonlyTool,
  toolChoiceForMode,
} from "../mcp/local_tools.js";
import type { McpRouter } from "../mcp/router.js";
import type { Store } from "../store/interfaces.js";
import { SESSION_REF_SOURCE_TOOL_READ } from "../store/types.js";
import type { WikiRefInput } from "./types.js";

export class PipelineMcpExecutor implements ToolExecutor {
  private localOnly = false;

  constructor(private readonly router: McpRouter) {}

  isLocalOnly(): boolean {
    return this.localOnly;
  }

  async listTools(): Promise<ToolDefinition[]> {
    if (this.localOnly) return [];
    try {
      const tools = await this.router.listToolsForJob();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
    } catch (error) {
      this.localOnly = true;
      throw error;
    }
  }

  async execute(name: string, argsJson: string): Promise<string> {
    if (this.localOnly) return "";
    let args: Record<string, unknown> = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    const { result, localOnly } = await this.router.callTool(name, args);
    if (localOnly) this.localOnly = true;
    return result;
  }
}

const LOCAL_PIPELINE_TOOLS = new Set(["search", "read", "web_fetch", "references", "audit", "structure", "gaps", "similar"]);

export class PipelineToolExecutor implements ToolExecutor {
  constructor(
    private readonly workspace: string,
    private readonly db: Store | null,
    private readonly mcpExec: PipelineMcpExecutor | null,
    private readonly toolMode: string,
  ) {}

  async listTools(): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];
    if (this.db) {
      for (const tool of builtinToolDefinitionsForMode(this.toolMode)) {
        tools.push({ name: tool.name, description: tool.description, parameters: tool.inputSchema });
      }
    }
    if (this.mcpExec && !this.mcpExec.isLocalOnly()) {
      try {
        tools.push(...(await this.mcpExec.listTools()));
      } catch {
        // external MCP unavailable; local tools still work
      }
    }
    return dedupeTools(tools);
  }

  async execute(name: string, argsJson: string): Promise<string> {
    const toolName = name.trim();
    if (LOCAL_PIPELINE_TOOLS.has(toolName.toLowerCase())) {
      if (!this.db) return "Error: database not connected";
      let args: Record<string, unknown> = {};
      if (argsJson) {
        try {
          args = JSON.parse(argsJson) as Record<string, unknown>;
        } catch {
          args = {};
        }
      }
      return executeLocalReadonlyTool(this.workspace, this.db, toolName, args);
    }
    if (this.mcpExec) return this.mcpExec.execute(toolName, argsJson);
    return "";
  }
}

export function dedupeTools(tools: ToolDefinition[]): ToolDefinition[] {
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];
  for (const tool of tools) {
    const key = tool.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tool);
  }
  return out;
}

export class ChatWikiExecutor implements ToolExecutor {
  constructor(
    private readonly workspace: string,
    private readonly db: Store | null,
    private readonly sessionId: string,
    private readonly router: McpRouter | null,
    private readonly mode: string,
    private readonly onToolRead: ((documentId: string, relativePath: string, title: string) => void) | null,
  ) {}

  async listTools(): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = builtinToolDefinitionsForMode(this.mode).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
    if (this.router) {
      try {
        const remote = await this.router.listToolsForChat();
        for (const tool of remote) {
          if (isWriteToolName(tool.name)) continue;
          tools.push({ name: tool.name, description: tool.description, parameters: tool.inputSchema });
        }
      } catch {
        // remote chat tools are optional
      }
    }
    return dedupeTools(tools);
  }

  async execute(name: string, argsJson: string): Promise<string> {
    const toolName = name.trim();
    if (isWriteToolName(toolName)) {
      throw new Error(`write tool "${toolName}" is not allowed in session chat`);
    }
    let args: Record<string, unknown> = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }

    if (this.router?.hasChatServers() && this.router.chatToolAllowed(toolName)) {
      try {
        const { result } = await this.router.callToolForChat(toolName, args);
        if (result) {
          await this.maybeRecordRead(toolName, args);
          return result;
        }
      } catch {
        // fall back to local tools
      }
    }

    if (!this.db) return "Error: database not connected";
    const out = await executeLocalReadonlyTool(this.workspace, this.db, toolName, args);
    await this.maybeRecordRead(toolName, args);
    return out;
  }

  private async maybeRecordRead(toolName: string, args: Record<string, unknown>): Promise<void> {
    if (!this.onToolRead || toolName.toLowerCase() !== "read" || !this.db) return;
    const value = args.path;
    const docPath = typeof value === "string" ? value.trim() : "";
    if (!docPath) return;
    let doc = await this.db.getDocument(docPath);
    if (!doc) doc = await this.db.findDocumentByName(docPath);
    if (!doc || doc.source_kind !== "wiki") return;
    this.onToolRead(doc.id, doc.relative_path, doc.title);
  }
}

export interface ToolEvent {
  phase: "start" | "done";
  toolName: string;
  detail: string;
}

export async function runSessionChatToolLoop(
  client: { chat: (messages: Message[], tools: ToolDefinition[] | null, temperature: number, maxTokens: number, options?: { toolChoice?: string }) => Promise<{ content: string; reasoningContent: string; toolCalls: Array<{ id: string; name: string; arguments: string }> }>; model: string },
  executor: ToolExecutor,
  messages: Message[],
  tools: ToolDefinition[],
  temperature: number,
  maxTokens: number,
  mode: string,
  onEvent: ((event: ToolEvent) => void) | null,
  recorder: SessionMessageRecorderPort | null,
  config?: ToolLoopConfig,
): Promise<string> {
  const maxRounds = config && config.maxRounds > 0 ? config.maxRounds : 8;
  const maxCalls =
    config && config.maxToolCallsPerRound > 0 ? config.maxToolCallsPerRound : 4;
  const msgs = [...messages];
  const useTools = tools.length > 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const stepName = `round_${round}`;
    const toolChoice = toolChoiceForMode(mode, round);
    recorder?.record(stepName, "llm_request", `${stepName} LLM request`, {
      messages: messageSummaries(msgs),
      tools_count: tools.length,
      temperature,
      max_tokens: maxTokens,
      tool_choice: toolChoice,
    });

    let result;
    try {
      result = useTools
        ? await client.chat(msgs, tools, temperature, maxTokens, { toolChoice })
        : await client.chat(msgs, null, temperature, maxTokens);
    } catch (error) {
      recorder?.record(stepName, "llm_error", `${stepName} LLM call failed`, {
        error: errorMessage(error),
      });
      if (toolChoice && isBadRequestError(error)) {
        result = useTools
          ? await client.chat(msgs, tools, temperature, maxTokens)
          : await client.chat(msgs, null, temperature, maxTokens);
      } else {
        throw error;
      }
    }

    recorder?.record(stepName, "llm_response", `${stepName} LLM response`, {
      content_preview: truncateForEvent(result.content, 500),
      content_chars: [...result.content].length,
      tool_calls_count: result.toolCalls.length,
      tool_calls: toolCallSummaries(result.toolCalls),
    });

    if (result.toolCalls.length === 0) {
      if (mode === "organize" && round === 0 && useTools) {
        msgs.push({ role: "assistant", content: result.content, reasoning_content: result.reasoningContent });
        msgs.push({
          role: "user",
          content: "请先调用 structure 和 audit 工具来诊断 wiki 的状况。展示目录结构时必须引用 structure 工具原始返回，不要自行编造目录树，然后再给出建议。",
        });
        const second = await client.chat(msgs, tools, temperature, maxTokens);
        if (second.toolCalls.length === 0) return second.content;
        result = second;
      } else {
        return result.content;
      }
    }
    if (!useTools) return result.content;

    const calls = result.toolCalls.slice(0, maxCalls);
    msgs.push({
      role: "assistant",
      content: result.content,
      reasoning_content: result.reasoningContent,
      tool_calls: calls,
    });

    for (const call of calls) {
      onEvent?.({ phase: "start", toolName: call.name, detail: truncateForEvent(call.arguments, 200) });
      const started = Date.now();
      let out: string;
      let execError: unknown = null;
      try {
        out = await executor.execute(call.name, call.arguments);
      } catch (error) {
        execError = error;
        out = `tool error: ${errorMessage(error)}`;
      }
      const durationMs = Date.now() - started;
      onEvent?.({ phase: "done", toolName: call.name, detail: truncateForEvent(out, 120) });
      recorder?.record(stepName, "tool_result", `${call.name} executed`, {
        tool_name: call.name,
        arguments: truncateForEvent(call.arguments, 2000),
        result_chars: [...out].length,
        duration_ms: durationMs,
        ...(execError ? { error: errorMessage(execError) } : { result_preview: truncateForEvent(out, 2000) }),
      });
      msgs.push({ role: "tool", content: out, tool_call_id: call.id, name: call.name });
    }
  }
  throw new Error(`tool loop exceeded max rounds (${maxRounds})`);
}

export interface SessionMessageRecorderPort {
  record(step: string, phase: string, message: string, payload: Record<string, unknown> | null): void;
}

export class SessionMessageRecorder implements SessionMessageRecorderPort {
  constructor(
    private readonly db: Store | null,
    private readonly messageId: string,
    private readonly maxCount: number,
  ) {}

  record(step: string, phase: string, message: string, payload: Record<string, unknown> | null): void {
    if (!this.db || !this.messageId) return;
    void this.db
      .insertSessionMessageEvent(this.messageId, step, phase, message, payload ?? {}, this.maxCount)
      .catch(() => undefined);
  }
}

export async function createSessionMessageRecorder(
  db: Store | null,
  messageId: string,
): Promise<SessionMessageRecorder> {
  let maxCount = 100;
  if (db) {
    try {
      maxCount = await db.getSessionMsgEventsMaxCount();
    } catch {
      maxCount = 100;
    }
  }
  return new SessionMessageRecorder(db, messageId, maxCount);
}

function messageSummaries(messages: Message[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const entry: Record<string, unknown> = {
      role: message.role,
      content_chars: [...(message.content ?? "")].length,
    };
    if (message.tool_calls?.length) entry.tool_calls = toolCallSummaries(message.tool_calls);
    if (message.tool_call_id) entry.tool_call_id = message.tool_call_id;
    if (message.name) entry.name = message.name;
    if (message.role === "system" || (message.content ?? "").length <= 500) {
      entry.content = message.content ?? "";
    } else {
      entry.content_preview = truncateForEvent(message.content ?? "", 300);
    }
    return entry;
  });
}

function toolCallSummaries(calls: Array<{ id: string; name: string; arguments: string }>): Array<Record<string, unknown>> {
  return calls.map((call) => ({
    id: call.id,
    name: call.name,
    arguments: truncateForEvent(call.arguments, 300),
  }));
}

function isBadRequestError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("HTTP 400") || message.includes("bad request");
}

export function stripToolMessages(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role === "assistant" && message.tool_calls?.length) {
      out.push({ role: message.role, content: message.content ?? "" });
    } else {
      out.push(message);
    }
  }
  return out;
}

export function truncateForEvent(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function recordSessionReferences(
  db: Store | null,
  sessionId: string,
  refs: WikiRefInput[],
  source: string,
): void {
  if (!db || !sessionId) return;
  for (const ref of refs) {
    void db
      .upsertSessionReference(sessionId, ref.documentId, ref.relativePath, ref.title, source)
      .catch((error) => logger.warn({ error }, "record session reference failed"));
  }
}

export function recordToolReadReference(
  db: Store | null,
  sessionId: string,
  documentId: string,
  relativePath: string,
  title: string,
): void {
  if (!db || !sessionId || !documentId) return;
  void db
    .upsertSessionReference(sessionId, documentId, relativePath, title, SESSION_REF_SOURCE_TOOL_READ)
    .catch(() => undefined);
}

export function wikiRefsJsonFromInputs(refs: WikiRefInput[]): string {
  if (refs.length === 0) return "[]";
  return JSON.stringify(
    refs.map((ref) => ({
      document_id: ref.documentId,
      relative_path: ref.relativePath,
      title: ref.title,
    })),
  );
}

export function wikiRefsFromStoredJson(raw: string): WikiRefInput[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];
  const parsed = JSON.parse(trimmed) as Array<{
    document_id?: string;
    relative_path?: string;
    title?: string;
  }>;
  return parsed.map((item) => ({
    documentId: item.document_id ?? "",
    relativePath: item.relative_path ?? "",
    title: item.title ?? "",
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
