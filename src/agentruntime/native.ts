import { clientFromInstance } from "../llm/instance_client.js";
import type { Client } from "../llm/client.js";
import { logger } from "../logger.js";
import { builtinToolDefinitionsForMode, toolMaxTokensForMode, toolTemperatureForMode } from "../mcp/local_tools.js";
import { McpRegistry } from "../mcp/registry.js";
import { McpRouter } from "../mcp/router.js";
import { toolLoopConfigForModeFromStore } from "../mcp/tool_loop_settings.js";
import type { Store } from "../store/interfaces.js";
import type { IngestSession, IngestSessionMessage } from "../store/types.js";
import { assembleIngestChatMessages } from "../ingest/session_chat.js";
import { ContextResolver, formatRelatedSubsetSection } from "../ingest/context.js";
import { promptStepForMode, resolveRulesSupplement } from "../ingest/prompts.js";
import {
  ChatWikiExecutor,
  recordToolReadReference,
  runSessionChatToolLoop,
  stripToolMessages,
} from "../ingest/tools.js";
import {
  AgentRuntimeError,
  ERR_NO_PROVIDER_INSTANCE,
  KIND_NATIVE,
  type EventSink,
  type PromptRequest,
  type PromptResult,
  type Runtime,
} from "./runtime.js";

export class NativeRuntime implements Runtime {
  constructor(
    private readonly db: Store,
    private readonly workspace: string,
    private readonly session: IngestSession | null,
    private readonly client: Client,
    private readonly model: string,
  ) {}

  kind(): string {
    return KIND_NATIVE;
  }

  label(): string {
    return `native / ${this.model}`;
  }

  async prompt(request: PromptRequest, sink: EventSink, signal?: AbortSignal): Promise<PromptResult> {
    if (!sink) throw new Error("event sink is nil");
    const displayContent = request.displayUserContent || request.userContent;
    const resolver = new ContextResolver(this.db, this.workspace);
    let subsetSection = "";
    try {
      const subset = await resolver.resolveRelatedSubset(displayContent, request.wikiRefs);
      subsetSection = formatRelatedSubsetSection(request.docLang, subset);
    } catch (error) {
      logger.warn({ error, sessionId: request.sessionId }, "agentruntime subset resolve failed");
    }

    const step = promptStepForMode(request.mode);
    const messages = assembleIngestChatMessages(
      request.history,
      request.userContent,
      request.docLang,
      this.workspace,
      await resolveRulesSupplement(this.db),
      subsetSection,
      step,
    );
    if (messages.length > 0 && messages[0]?.content) {
      const systemPrompt = messages[0].content;
      sink.debug("compose", "system_prompt", "System prompt assembled", {
        system_prompt: truncateDebug(systemPrompt, 32 * 1024),
        total_chars: [...systemPrompt].length,
        message_count: messages.length,
        model: this.model,
      });
    }

    const router = await sessionChatRouter(this.db);
    const executor = new ChatWikiExecutor(
      this.workspace,
      this.db,
      request.sessionId,
      router,
      request.mode,
      (documentId, relativePath, title) =>
        recordToolReadReference(this.db, request.sessionId, documentId, relativePath, title),
    );
    const tools = await executor.listTools();
    const config = await toolLoopConfigForModeFromStore(request.mode, this.db);
    const temperature = toolTemperatureForMode(request.mode);
    const maxTokens = toolMaxTokensForMode(request.mode);

    let finalText: string;
    try {
      finalText = await runSessionChatToolLoop(
        this.client,
        executor,
        messages,
        tools,
        temperature,
        maxTokens,
        request.mode,
        (event) => {
          if (event.phase === "start") sink.toolStart(event.toolName, event.detail);
          else sink.toolDone(event.toolName, event.detail);
        },
        request.recorder,
        config,
      );
    } catch (error) {
      sink.warning("tool_loop_failed", errorMessage(error));
      request.recorder?.record("fallback", "tool_loop_failed", "Tool loop failed, falling back to direct stream", {
        error: errorMessage(error),
      });
      const cleaned = stripToolMessages(messages);
      const chunks: string[] = [];
      for await (const event of this.client.streamChat(cleaned, 0.7, 2048, signal)) {
        if (event.type === "token") {
          chunks.push(event.content ?? "");
          sink.token(event.content ?? "");
        } else if (event.type === "error") {
          throw event.error ?? new Error("LLM stream failed");
        }
      }
      if (signal?.aborted) throw abortError();
      return { text: chunks.join(""), stopReason: "end_turn" };
    }

    if (finalText) sink.token(finalText);
    return { text: finalText, stopReason: "end_turn" };
  }
}

export async function createNativeRuntime(
  db: Store,
  workspace: string,
  session: IngestSession | null,
): Promise<Runtime> {
  if (!session) {
    throw new AgentRuntimeError(ERR_NO_PROVIDER_INSTANCE, "no provider instance: session is nil");
  }
  let instanceId = session.llm_instance_id;
  let model = session.llm_model;
  if (!instanceId) instanceId = await db.getConfig("last_instance_id");
  if (!model) model = await db.getConfig("last_model");
  let client: Client;
  try {
    client = await clientFromInstance(db, instanceId, model);
  } catch (error) {
    throw new AgentRuntimeError(ERR_NO_PROVIDER_INSTANCE, errorMessage(error));
  }
  return new NativeRuntime(db, workspace, session, client, model);
}

export async function sessionChatRouter(db: Store): Promise<McpRouter | null> {
  try {
    const raw = await db.getConfig("mcp_servers_json");
    return new McpRouter(new McpRegistry(raw));
  } catch {
    return null;
  }
}

function truncateDebug(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…(truncated)`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export type { IngestSessionMessage };
