import {
  createHarness,
  createPermissionHandlerForMode,
  createPolicyPermissionHandler,
  isHarnixError,
  lookPath,
  type AcpAgentEntry,
  type HarnixSettings,
  type HarnessDebugEvent,
  type HarnessEvent,
  type HarnessKind,
  type HarnessMessage,
  type HarnessProviderCredentials,
  type HarnessStopReason,
  type HarnessTool,
  type HarnessToolChoice,
  type PermissionHandler,
} from "harnix";
import { ContextResolver, formatRelatedSubsetSection } from "../ingest/context.js";
import { promptStepForMode, resolveRulesSupplement } from "../ingest/prompts.js";
import { assembleIngestChatMessages } from "../ingest/session_chat.js";
import { ChatWikiExecutor, recordToolReadReference } from "../ingest/tools.js";
import { logger } from "../logger.js";
import {
  toolChoiceForMode,
  toolMaxTokensForMode,
  toolTemperatureForMode,
} from "../mcp/local_tools.js";
import { McpRegistry } from "../mcp/registry.js";
import { McpRouter } from "../mcp/router.js";
import { toolLoopConfigForModeFromStore } from "../mcp/tool_loop_settings.js";
import type { Store } from "../store/interfaces.js";
import type { IngestSession, IngestSessionMessage } from "../store/types.js";
import { HarnessManager, resolveCwd } from "./manager.js";
import { loadHarnixSettings, resolveProviderCredentials } from "./settings.js";

export const KIND_NATIVE = "native";
export const KIND_PI = "pi";
export const KIND_ACP = "acp";
export const VALID_AGENT_KINDS = new Set<string>([KIND_NATIVE, KIND_PI, KIND_ACP]);

export type AgentRuntimeErrorCode =
  | "no_provider_instance"
  | "no_acp_agent"
  | "acp_agent_disabled"
  | "acp_cli_not_found"
  | "acp_config_invalid"
  | "invalid_harness_kind";

export const ERR_NO_PROVIDER_INSTANCE: AgentRuntimeErrorCode = "no_provider_instance";
export const ERR_NO_ACP_AGENT: AgentRuntimeErrorCode = "no_acp_agent";
export const ERR_ACP_AGENT_DISABLED: AgentRuntimeErrorCode = "acp_agent_disabled";
export const ERR_ACP_CLI_NOT_FOUND: AgentRuntimeErrorCode = "acp_cli_not_found";
export const ERR_ACP_CONFIG_INVALID: AgentRuntimeErrorCode = "acp_config_invalid";
export const ERR_INVALID_HARNESS_KIND: AgentRuntimeErrorCode = "invalid_harness_kind";

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

function mapStopReason(stopReason: HarnessStopReason): string {
  switch (stopReason) {
    case "completed":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "max_turns":
      return "max_turn_requests";
    case "cancelled":
      return "cancelled";
    default:
      return "error";
  }
}

function toToolChoice(raw: string): HarnessToolChoice | undefined {
  if (raw === "auto" || raw === "required" || raw === "none") return raw;
  return undefined;
}

function truncateText(value: string, max: number): string {
  const trimmed = value.trim();
  const runes = [...trimmed];
  return runes.length <= max ? trimmed : `${runes.slice(0, max).join("")}…`;
}

export async function sessionChatRouter(db: Store): Promise<McpRouter | null> {
  try {
    const raw = await db.getConfig("mcp_servers_json");
    return new McpRouter(new McpRegistry(raw));
  } catch {
    return null;
  }
}

function toAcpHistoryMessages(history: IngestSessionMessage[]): HarnessMessage[] {
  const out: HarnessMessage[] = [];
  for (const msg of history) {
    if (msg.stream_status === "streaming" || msg.role === "system") continue;
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const content = msg.content.trim();
    if (!content) continue;
    out.push({ role: msg.role, content });
  }
  return out.slice(-47);
}

export class HarnixChatRuntime implements Runtime {
  constructor(
    private readonly db: Store,
    private readonly workspace: string,
    private readonly harnessKind: HarnessKind,
    private readonly settings: HarnixSettings,
    private readonly provider?: HarnessProviderCredentials,
    private readonly acpEntry?: AcpAgentEntry,
    private readonly harnessMgr?: HarnessManager,
  ) {}

  kind(): string {
    return this.harnessKind;
  }

  label(): string {
    if (this.harnessKind === "acp") {
      return `acp / ${this.acpEntry?.name ?? "agent"}`;
    }
    return `${this.harnessKind} / ${this.provider?.model ?? ""}`;
  }

  async prompt(request: PromptRequest, sink: EventSink, signal?: AbortSignal): Promise<PromptResult> {
    if (!sink) throw new Error("event sink is nil");

    const onEvent = (event: HarnessEvent): void => {
      switch (event.type) {
        case "text.delta":
          sink.token(event.text);
          return;
        case "thought.delta":
          sink.thought(event.text);
          return;
        case "tool.started": {
          const detail =
            event.title || (event.input !== undefined ? JSON.stringify(event.input) : "");
          sink.toolStart(event.toolName, truncateText(detail, 500));
          return;
        }
        case "tool.completed":
          sink.toolDone(event.toolName, truncateText(event.content, 500));
          return;
        case "plan.updated":
          sink.plan(
            event.entries.map((entry) => ({
              content: entry.content,
              priority: entry.priority ?? "",
              status: entry.status,
            })),
          );
          return;
        case "permission.resolved":
          sink.permission({
            outcome: event.decision.outcome === "allow" ? "selected" : event.decision.outcome,
            optionId: event.decision.optionId ?? "",
            allowed: event.decision.outcome === "allow",
            reason: event.decision.reason ?? "",
            toolKind: "",
            toolTitle: "",
          });
          return;
        case "usage.updated":
          sink.debug("harness", "usage_updated", "Harness usage updated", {
            turns: event.usage.turns,
            tool_calls: event.usage.toolCalls,
            input_tokens: event.usage.inputTokens,
            output_tokens: event.usage.outputTokens,
            total_tokens: event.usage.totalTokens,
          });
          return;
        case "run.failed":
          sink.warning("harness_run_failed", event.error.message);
          return;
      }
    };

    const onDebug = (ev: HarnessDebugEvent): void => {
      sink.debug(ev.step, ev.phase, ev.message, ev.payload ?? {});
    };

    if (this.harnessKind === "acp") {
      if (!this.acpEntry || !this.harnessMgr) {
        throw new AgentRuntimeError(ERR_NO_ACP_AGENT, "ACP agent or manager is unavailable");
      }
      const cwd = await resolveCwd(this.workspace, request.sessionId, this.acpEntry.cwdPolicy);
      const acpHarness = this.harnessMgr.acquireAcpHarness(this.acpEntry.id, this.settings, cwd);
      const acpPermHandler = createPolicyPermissionHandler({
        allowRead: this.acpEntry.permission.allowRead,
        allowSearch: this.acpEntry.permission.allowSearch,
        allowFetch: this.acpEntry.permission.allowFetch,
        allowWrite: this.acpEntry.permission.allowWrite,
        allowExecute: this.acpEntry.permission.allowExecute,
        readonlyOnly: this.settings.acp.defaults.readonlyOnly,
      });

      const result = await acpHarness.run(
        {
          sessionId: request.sessionId,
          cwd,
          input: request.userContent,
          history: toAcpHistoryMessages(request.history),
          limits: { timeoutMs: this.acpEntry.promptTimeoutMs },
        },
        {
          signal,
          onEvent,
          onPermission: acpPermHandler,
          onDebug,
        },
      );
      return { text: result.text, stopReason: mapStopReason(result.stopReason) };
    }

    // Native / Pi path
    const displayContent = request.displayUserContent || request.userContent;
    const resolver = new ContextResolver(this.db, this.workspace);
    let subsetSection = "";
    try {
      const subset = await resolver.resolveRelatedSubset(displayContent, request.wikiRefs);
      subsetSection = formatRelatedSubsetSection(request.docLang, subset);
    } catch (error) {
      logger.warn({ error, sessionId: request.sessionId }, "harness subset resolve failed");
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

    const systemPrompt = messages[0]?.role === "system" ? messages[0].content : undefined;
    if (systemPrompt) {
      sink.debug("compose", "system_prompt", "System prompt assembled", {
        system_prompt: truncateText(systemPrompt, 32 * 1024),
        total_chars: [...systemPrompt].length,
        message_count: messages.length,
        model: this.provider?.model ?? "",
        harness_kind: this.harnessKind,
      });
    }

    const historyMessages: HarnessMessage[] = messages
      .slice(systemPrompt ? 1 : 0, Math.max(0, messages.length - 1))
      .filter((m): m is { role: "user" | "assistant" | "system"; content: string } => Boolean(m.content))
      .map((m) => ({ role: m.role, content: m.content }));

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
    const toolDefs = await executor.listTools();
    const harnessTools: HarnessTool[] = toolDefs.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object" },
      async execute(args) {
        try {
          const out = await executor.execute(tool.name, JSON.stringify(args));
          return { content: out, isError: false };
        } catch (err) {
          return {
            content: `tool error: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      },
    }));

    const loopCfg = await toolLoopConfigForModeFromStore(request.mode, this.db);
    const kindCfg = this.harnessKind === "pi" ? this.settings.pi : this.settings.native;
    const permissionHandler: PermissionHandler = createPermissionHandlerForMode(kindCfg.permissionMode);

    const harness = createHarness({
      kind: this.harnessKind,
      settings: this.settings,
      provider: this.provider,
      defaultTools: harnessTools,
    });

    const temperature =
      this.harnessKind === "native" && this.settings.native.temperature !== undefined
        ? this.settings.native.temperature
        : toolTemperatureForMode(request.mode);
    const maxTokens =
      this.harnessKind === "pi"
        ? this.settings.pi.maxTokens
        : this.settings.native.maxTokens ?? toolMaxTokensForMode(request.mode);

    const result = await harness.run(
      {
        sessionId: request.sessionId,
        input: request.userContent,
        systemPrompt,
        history: historyMessages,
        tools: harnessTools,
        temperature,
        maxTokens,
        toolChoice: toToolChoice(toolChoiceForMode(request.mode, 0)),
        limits: {
          maxTurns: loopCfg.maxRounds > 0 ? loopCfg.maxRounds : kindCfg.maxTurns,
          maxToolCalls: kindCfg.maxToolCalls,
          maxToolCallsPerTurn:
            loopCfg.maxToolCallsPerRound > 0
              ? loopCfg.maxToolCallsPerRound
              : kindCfg.maxToolCallsPerTurn,
          timeoutMs: kindCfg.timeoutMs,
        },
      },
      {
        signal,
        onEvent,
        onPermission: permissionHandler,
        onDebug,
      },
    );

    if (isHarnixError(result)) {
      return { text: result.text, stopReason: "error" };
    }
    return { text: result.text, stopReason: mapStopReason(result.stopReason) };
  }
}

export async function resolveSessionRuntime(
  db: Store,
  workspace: string,
  harnessMgr: HarnessManager | null,
  session: IngestSession | null,
): Promise<Runtime> {
  if (!session) {
    throw new AgentRuntimeError(ERR_NO_PROVIDER_INSTANCE, "no provider instance: session is nil");
  }

  let settings: HarnixSettings;
  try {
    settings = await loadHarnixSettings(db);
  } catch (error) {
    throw new AgentRuntimeError(
      ERR_ACP_CONFIG_INVALID,
      `Harness settings invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const rawKind = (session.agent_kind || settings.defaultKind).trim().toLowerCase();
  if (!VALID_AGENT_KINDS.has(rawKind)) {
    throw new AgentRuntimeError(ERR_INVALID_HARNESS_KIND, `invalid agent_kind: ${rawKind}`);
  }
  const kind = rawKind as HarnessKind;

  if (kind === "acp") {
    const agentId = session.acp_agent_id.trim() || settings.acp.defaultAgentId.trim();
    const entry = settings.acp.agents[agentId];
    if (!entry) {
      throw new AgentRuntimeError(
        ERR_NO_ACP_AGENT,
        `no ACP agent: agent "${agentId}" is not configured`,
      );
    }
    if (!entry.enabled) {
      throw new AgentRuntimeError(ERR_ACP_AGENT_DISABLED, `ACP agent disabled: ${entry.name}`);
    }
    if (!(await lookPath(entry.command))) {
      throw new AgentRuntimeError(ERR_ACP_CLI_NOT_FOUND, `ACP CLI not found: ${entry.command}`);
    }
    if (!harnessMgr) {
      throw new AgentRuntimeError(
        ERR_ACP_CONFIG_INVALID,
        "ACP config invalid: Harness manager is unavailable",
      );
    }
    return new HarnixChatRuntime(db, workspace, "acp", settings, undefined, entry, harnessMgr);
  }

  let instanceId = session.llm_instance_id;
  let model = session.llm_model;
  if (!instanceId) instanceId = await db.getConfig("last_instance_id");
  if (!model) model = await db.getConfig("last_model");
  let provider: HarnessProviderCredentials;
  try {
    provider = await resolveProviderCredentials(db, instanceId, model);
  } catch (error) {
    throw new AgentRuntimeError(
      ERR_NO_PROVIDER_INSTANCE,
      error instanceof Error ? error.message : String(error),
    );
  }
  return new HarnixChatRuntime(db, workspace, kind, settings, provider);
}

export type { IngestSession };
