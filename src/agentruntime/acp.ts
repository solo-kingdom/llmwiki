import type { AcpConfig, AgentConfig } from "../acp/config.js";
import { DEFAULT_PROMPT_TIMEOUT_MS } from "../acp/config.js";
import type { AcpConn } from "../acp/manager.js";
import { AcpManager } from "../acp/manager.js";
import { resolveCwd } from "../acp/cwd.js";
import { cancelledDecision, decidePermission } from "../acp/permission.js";
import { sanitizeText } from "../acp/sanitize.js";
import { resolveRulesSupplement } from "../ingest/prompts.js";
import type { IngestSessionMessage } from "../store/types.js";
import {
  KIND_ACP,
  type EventSink,
  type PermissionDecision,
  type PlanEntry,
  type PromptRequest,
  type PromptResult,
  type Runtime,
} from "./runtime.js";

export class AcpRuntime implements Runtime {
  private readonly agent: AgentConfig;
  private readonly config: AcpConfig;

  constructor(
    private readonly manager: AcpManager,
    private readonly workspace: string,
    config: AcpConfig,
    agent: AgentConfig,
  ) {
    this.config = config;
    this.agent = agent;
  }

  kind(): string {
    return KIND_ACP;
  }

  label(): string {
    return `acp / ${this.agent.name}`;
  }

  async prompt(request: PromptRequest, sink: EventSink, signal?: AbortSignal): Promise<PromptResult> {
    if (!sink) throw new Error("event sink is nil");
    const cwd = await resolveCwd(this.workspace, request.sessionId, this.agent.cwd_policy);
    const timeout = this.agent.prompt_timeout_ms > 0 ? this.agent.prompt_timeout_ms : DEFAULT_PROMPT_TIMEOUT_MS;
    const promptSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeout)]);

    let conn = await this.manager.acquire(request.sessionId, this.agent, cwd, promptSignal);
    let promptText = request.userContent;
    if (!conn.historyReplayed && request.history.length > 0) {
      promptText = renderAcpHistory(request.history, request.userContent);
      conn.historyReplayed = true;
      sink.debug("acp_turn", "acp_history_replay", "ACP history guidance injected", {
        history_messages: request.history.length,
      });
    }

    let tracker = new TrackingSink(sink);
    const toolNames = new Map<string, string>();
    const attempt = async (current: AcpConn): Promise<PromptResult> => {
      const onPermission = (permissionRequest: Parameters<typeof decidePermission>[2]) => {
        if (promptSignal.aborted) return cancelledDecision(permissionRequest);
        const decision = decidePermission(this.agent.permission, this.config.defaults.readonly_only, permissionRequest);
        tracker.permission({
          outcome: decision.outcome,
          optionId: decision.option_id ?? "",
          allowed: decision.allowed,
          reason: decision.reason ?? "",
          toolKind: decision.tool_kind,
          toolTitle: decision.tool_title ?? "",
        });
        return decision;
      };
      const stopReason = await current.client.prompt(
        current.remoteSessionId,
        promptText,
        {
          onEvent: (event) => this.forwardEvent(sink, tracker, event, toolNames),
          onPermission,
        },
        promptSignal,
      );
      if (stopReason) {
        sink.debug("acp_turn", "acp_stop_reason", "ACP prompt stopped", { stop_reason: stopReason });
      }
      return { text: tracker.text, stopReason };
    };

    let result: PromptResult;
    try {
      result = await attempt(conn);
    } catch (error) {
      if (!tracker.hasToken && !promptSignal.aborted) {
        sink.debug("acp_turn", "acp_process_restart", "ACP process restarted after pre-token failure", {
          error: sanitizeText(errorMessage(error)),
        });
        this.manager.invalidate(request.sessionId);
        conn = await this.manager.acquire(request.sessionId, this.agent, cwd, promptSignal);
        if (request.history.length > 0) {
          conn.historyReplayed = true;
          promptText = renderAcpHistory(request.history, request.userContent);
        }
        tracker = new TrackingSink(sink);
        try {
          result = await attempt(conn);
        } catch (retryError) {
          if (isCancelTimeout(retryError)) this.manager.invalidate(request.sessionId);
          sink.debug("acp_turn", "acp_process_exit", "ACP prompt failed", {
            error: sanitizeText(errorMessage(retryError)),
            stderr_tail: conn.stderrTail(),
          });
          throw retryError;
        }
      } else {
        if (isCancelTimeout(error)) this.manager.invalidate(request.sessionId);
        sink.debug("acp_turn", "acp_process_exit", "ACP prompt failed", {
          error: sanitizeText(errorMessage(error)),
          stderr_tail: conn.stderrTail(),
        });
        throw error;
      }
    }

    if (promptSignal.aborted && !signal?.aborted) {
      throw new Error("ACP prompt timeout: AbortError");
    }
    if (signal?.aborted) {
      return { text: tracker.text, stopReason: "cancelled" };
    }
    return { text: tracker.text, stopReason: result.stopReason };
  }

  private forwardEvent(
    sink: EventSink,
    tracker: TrackingSink,
    event: {
      kind: string;
      text: string;
      toolCallId: string;
      toolName: string;
      toolKind: string;
      toolStatus: string;
      toolTitle: string;
      toolRawInput?: unknown;
      toolRawOutput?: unknown;
      plan: Array<{ content: string; priority?: string; status: string }>;
      raw: Record<string, unknown>;
    },
    toolNames: Map<string, string>,
  ): void {
    switch (event.kind) {
      case "message":
        if (!event.text) {
          sink.warning("acp_unsupported_content", "ACP agent sent an unsupported content block");
          sink.debug("acp_turn", "agent_message_unsupported", "Unsupported ACP content block", { raw: event.raw });
          return;
        }
        tracker.token(event.text);
        return;
      case "thought":
        sink.thought(event.text);
        return;
      case "tool_call": {
        const name = event.toolName || event.toolKind;
        const detail =
          event.toolTitle || (event.toolRawInput !== undefined ? JSON.stringify(event.toolRawInput) : "");
        if (event.toolCallId && name) toolNames.set(event.toolCallId, name);
        sink.toolStart(name, truncateAcpDetail(detail));
        return;
      }
      case "tool_call_update": {
        const detail =
          event.toolRawOutput !== undefined ? JSON.stringify(event.toolRawOutput) : "";
        const name = event.toolName || toolNames.get(event.toolCallId) || "";
        if (event.toolStatus === "completed" || event.toolStatus === "failed") {
          sink.toolDone(name, truncateAcpDetail(detail));
        }
        return;
      }
      case "plan": {
        const entries: PlanEntry[] = event.plan.map((entry) => ({
          content: entry.content,
          priority: entry.priority ?? "",
          status: entry.status,
        }));
        sink.plan(entries);
        return;
      }
      case "usage":
        sink.debug("acp_turn", "acp_usage", "ACP usage update", event.raw);
        return;
      case "user_echo":
        sink.debug("acp_turn", "user_message_echo", "ACP user message echo", event.raw);
        return;
      default:
        sink.debug("acp_turn", "acp_update_ignored", "Unknown ACP update", event.raw);
    }
  }
}

class TrackingSink {
  text = "";
  hasToken = false;

  constructor(private readonly inner: EventSink) {}

  token(value: string): void {
    if (!value) return;
    this.hasToken = true;
    this.text += value;
    this.inner.token(value);
  }

  permission(decision: PermissionDecision): void {
    this.inner.permission(decision);
  }
}

export function newAcpRuntime(
  manager: AcpManager,
  workspace: string,
  config: AcpConfig,
  agent: AgentConfig,
): Runtime {
  return new AcpRuntime(manager, workspace, config, agent);
}

function renderAcpHistory(history: IngestSessionMessage[], current: string): string {
  const items: Array<{ role: string; content: string }> = [];
  for (const message of history) {
    if (message.stream_status === "streaming" || message.role === "system") continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = message.content.trim();
    if (!content) continue;
    items.push({ role: message.role, content });
  }
  const tail = items.slice(-47);
  const parts: string[] = [];
  if (tail.length > 0) {
    parts.push("以下是 llmwiki 会话历史，用于恢复上下文。\n\n");
    for (const item of tail) {
      parts.push(item.role === "user" ? "## User\n" : "## Assistant\n", item.content, "\n\n");
    }
  }
  parts.push("## User\n", current);
  return parts.join("");
}

function truncateAcpDetail(detail: string): string {
  const cleaned = sanitizeText(detail.trim());
  const runes = [...cleaned];
  return runes.length <= 500 ? cleaned : `${runes.slice(0, 500).join("")}…`;
}

function isCancelTimeout(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("cancel timeout") || message.includes("ErrCancelTimeout");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { resolveRulesSupplement };
