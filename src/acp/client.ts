import path from "node:path";
import {
  applyAgentDefaults,
  DEFAULT_IDLE_TIMEOUT_MS,
  type AgentConfig,
} from "./config.js";
import { decodeSessionUpdate, type AcpEvent } from "./events.js";
import { AcpError, ErrCancelTimeout, protocolVersionUnsupported } from "./errors.js";
import { JsonRpcConn, methodNotFound } from "./jsonrpc.js";
import {
  cancelledDecision,
  decodePermissionRequest,
  type PermissionDecision,
  type PermissionRequest,
} from "./permission.js";
import type { AgentProcess } from "./process.js";

export let acpClientVersion = "dev";

export function setAcpClientVersion(version: string): void {
  acpClientVersion = version;
}

export interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface AgentInfo {
  name: string;
  version: string;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: Record<string, unknown>;
  agentInfo: AgentInfo;
  authMethods: unknown[];
}

export interface Handlers {
  onEvent?: (event: AcpEvent) => void;
  onPermission?: (request: PermissionRequest) => PermissionDecision;
}

interface PromptOutcome {
  stopReason: string;
  error?: Error;
}

class ActivePrompt {
  readonly handlers: Handlers;
  cancelled = false;
  outcome: Promise<PromptOutcome> | null = null;
  private waiters: (() => void)[] = [];

  constructor(handlers: Handlers) {
    this.handlers = handlers;
  }

  markCancelled(): void {
    this.cancelled = true;
  }

  onActivity(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  nextActivity(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class AcpClient {
  private readonly conn: JsonRpcConn;
  private readonly active = new Map<string, ActivePrompt>();

  constructor(
    private readonly process: AgentProcess,
    private readonly cfg: AgentConfig,
  ) {
    this.conn = new JsonRpcConn(process);
    this.conn.setNotificationHandler((method, params) => this.handleNotification(method, params));
    this.conn.setRequestHandler((method, params) => this.handleRequest(method, params));
  }

  async initialize(signal?: AbortSignal): Promise<InitializeResult> {
    const result = (await this.conn.call(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "llmwiki", title: "LLM Wiki", version: acpClientVersion },
      },
      signal,
    )) as InitializeResult;
    if (result.protocolVersion !== 1) {
      throw protocolVersionUnsupported(result.protocolVersion);
    }
    return result;
  }

  async newSession(cwd: string, signal?: AbortSignal): Promise<string> {
    const absolute = path.resolve(cwd);
    const result = (await this.conn.call(
      "session/new",
      { cwd: absolute, mcpServers: [] },
      signal,
    )) as { sessionId?: string };
    if (!result.sessionId) throw new Error("ACP session/new returned empty sessionId");
    return result.sessionId;
  }

  async prompt(
    sessionId: string,
    text: string,
    handlers: Handlers,
    signal?: AbortSignal,
  ): Promise<string> {
    const active = new ActivePrompt(handlers);
    this.active.set(sessionId, active);
    try {
      const outcomePromise = this.startPrompt(sessionId, text);
      active.outcome = outcomePromise;
      const idleMs = this.cfg.idle_timeout_ms || DEFAULT_IDLE_TIMEOUT_MS;

      while (true) {
        const result = await raceWithAbort<
          | { kind: "outcome"; outcome: PromptOutcome }
          | { kind: "activity" }
          | { kind: "idle" }
        >(
          [
            outcomePromise.then((outcome) => ({ kind: "outcome" as const, outcome })),
            active.nextActivity().then(() => ({ kind: "activity" as const })),
            delay(idleMs).then(() => ({ kind: "idle" as const })),
          ],
          signal,
        );
        if (result.kind === "outcome") {
          if (result.outcome.error) throw result.outcome.error;
          return result.outcome.stopReason;
        }
        if (result.kind === "activity") continue;
        if (result.kind === "abort") {
          active.markCancelled();
          await this.cancel(sessionId);
          const outcome = await outcomePromise;
          if (outcome.error) throw outcome.error;
          return outcome.stopReason;
        }
        active.markCancelled();
        try {
          await this.cancel(sessionId);
        } catch (error) {
          if (error instanceof Error && error.message === ErrCancelTimeout) throw error;
        }
        const outcome = await outcomePromise;
        if (outcome.error) throw outcome.error;
        return outcome.stopReason;
      }
    } finally {
      if (this.active.get(sessionId) === active) this.active.delete(sessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId);
    const notifyPromise = this.conn.notify("session/cancel", { sessionId });
    if (!active) {
      await notifyPromise;
      return;
    }
    const notifyResult = await notifyPromise.then(
      () => ({ ok: true as const }),
      (error: Error) => ({ ok: false as const, error }),
    );
    if (!notifyResult.ok) throw notifyResult.error;
    if (!active.outcome) return;
    const finished = await Promise.race([
      active.outcome.then(() => "done" as const),
      delay(5000).then(() => "timeout" as const),
    ]);
    if (finished === "timeout") throw new AcpError(ErrCancelTimeout, ErrCancelTimeout);
  }

  async close(): Promise<void> {
    this.process.closeStdin();
    const result = await Promise.race([
      this.process.waitDone.then(() => "done" as const),
      delay(2000).then(() => "timeout" as const),
    ]);
    if (result === "done") return;
    await this.process.terminate();
  }

  stderrTail(): string {
    return this.process.stderrTail();
  }

  private async startPrompt(sessionId: string, text: string): Promise<PromptOutcome> {
    try {
      const result = (await this.conn.call("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      })) as { stopReason?: string };
      return { stopReason: result.stopReason ?? "" };
    } catch (error) {
      let finalError = error instanceof Error ? error : new Error(String(error));
      const tail = this.process.stderrTail();
      if (tail) finalError = new Error(`${finalError.message}: ${tail}`);
      return { stopReason: "", error: finalError };
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== "session/update") return;
    const sessionId = sessionIdFromParams(params);
    const active = this.active.get(sessionId);
    if (!active) return;
    active.onActivity();
    try {
      const event = decodeSessionUpdate(params);
      active.handlers.onEvent?.(event);
    } catch {
      // Malformed session updates are ignored, matching the Go client.
    }
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== "session/request_permission") throw methodNotFound();
    const request = decodePermissionRequest(params);
    const active = this.active.get(request.sessionId);
    let decision = cancelledDecision(request);
    if (active && !active.cancelled) {
      if (active.handlers.onPermission) {
        decision = active.handlers.onPermission(request);
      } else {
        decision = cancelledDecision(request);
      }
    }
    return permissionResponse(decision);
  }
}

function sessionIdFromParams(params: unknown): string {
  if (params && typeof params === "object") {
    const sessionId = (params as Record<string, unknown>)["sessionId"];
    if (typeof sessionId === "string") return sessionId;
  }
  return "";
}

function permissionResponse(decision: PermissionDecision): Record<string, unknown> {
  if (decision.outcome === "selected" && decision.option_id) {
    return { outcome: { outcome: "selected", optionId: decision.option_id } };
  }
  return { outcome: { outcome: "cancelled" } };
}

type RaceResult<T> = T | { kind: "abort" };

async function raceWithAbort<T>(
  promises: Promise<T>[],
  signal?: AbortSignal,
): Promise<RaceResult<T>> {
  if (!signal) return Promise.race(promises);
  if (signal.aborted) return { kind: "abort" };
  const abortPromise = new Promise<{ kind: "abort" }>((resolve) => {
    signal.addEventListener("abort", () => resolve({ kind: "abort" }), { once: true });
  });
  return Promise.race([...promises, abortPromise]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
