import { recordSync, record } from "../activity/index.js";
import type { EventSink, PermissionDecision, PlanEntry } from "../agentruntime/runtime.js";
import type { SessionMessageRecorderPort } from "../ingest/tools.js";
import type { Store } from "../store/interfaces.js";

type SendEvent = (event: string, payload: unknown) => void;

export class SseEventSink implements EventSink {
  private content = "";
  private lastFlushAt = 0;
  private lastFlush = Date.now();

  constructor(
    private readonly sendEvent: SendEvent,
    private readonly db: Store | null,
    private readonly assistantMsgId: string,
    private readonly recorder: SessionMessageRecorderPort | null,
  ) {}

  token(text: string): void {
    if (!text) return;
    this.content += text;
    const shouldFlush =
      this.content.length - this.lastFlushAt >= 32 || Date.now() - this.lastFlush >= 300;
    if (shouldFlush) {
      this.lastFlush = Date.now();
      this.lastFlushAt = this.content.length;
      if (this.db && this.assistantMsgId) {
        void this.db
          .updateIngestSessionMessageContent(this.assistantMsgId, this.content, "streaming")
          .catch(() => undefined);
      }
    }
    this.sendEvent("token", { content: text });
  }

  flush(): string {
    this.lastFlushAt = this.content.length;
    this.lastFlush = Date.now();
    if (this.db && this.assistantMsgId) {
      void this.db
        .updateIngestSessionMessageContent(this.assistantMsgId, this.content, "streaming")
        .catch(() => undefined);
    }
    return this.content;
  }

  currentContent(): string {
    return this.content;
  }

  thought(text: string): void {
    this.sendEvent("thought", { content: text });
    this.record("acp_turn", "agent_thought", "ACP agent thought", { content: text });
  }

  toolStart(name: string, detail: string): void {
    this.sendEvent("tool_start", { tool: name, detail });
    this.record("acp_turn", "acp_tool_call", "ACP tool call started", { tool: name, detail });
  }

  toolDone(name: string, detail: string): void {
    this.sendEvent("tool_done", { tool: name, detail });
    this.record("acp_turn", "acp_tool_call_update", "ACP tool call completed", { tool: name, detail });
  }

  plan(entries: PlanEntry[]): void {
    this.sendEvent("plan", { entries });
    this.record("acp_turn", "acp_plan", "ACP plan updated", {
      entries: entries.map((entry) => ({
        content: entry.content,
        priority: entry.priority,
        status: entry.status,
      })),
    });
  }

  permission(decision: PermissionDecision): void {
    this.sendEvent("permission", decision);
    this.record("acp_turn", "acp_permission", "ACP permission decided", {
      allowed: decision.allowed,
      reason: decision.reason,
      tool_kind: decision.toolKind,
      tool_title: decision.toolTitle,
    });
    const db = this.db;
    if (db) {
      recordSync(db, {
        level: "info",
        category: "agent",
        action: "acp_permission",
        message: "ACP agent permission decision",
        resourceType: "ingest_session",
        resourceId: this.assistantMsgId,
        status: "success",
        source: "api",
        details: {
          allowed: decision.allowed,
          reason: decision.reason,
          tool_kind: decision.toolKind,
        },
      });
    }
  }

  warning(code: string, message: string): void {
    this.sendEvent("warning", { code, message });
    this.record("acp_turn", code, message, null);
  }

  debug(step: string, phase: string, message: string, payload: Record<string, unknown>): void {
    this.record(step, phase, message, payload);
  }

  recordActivity(
    action: string,
    message: string,
    status: string,
    details: Record<string, unknown> | null,
  ): void {
    if (!this.db) return;
    record(this.db, {
      level: "info",
      category: "ingest",
      action,
      message,
      resourceType: "ingest_session",
      resourceId: this.assistantMsgId,
      status,
      source: "api",
      details: details ?? undefined,
    });
  }

  private record(
    step: string,
    phase: string,
    message: string,
    payload: Record<string, unknown> | null,
  ): void {
    this.recorder?.record(step, phase, message, payload);
  }
}
