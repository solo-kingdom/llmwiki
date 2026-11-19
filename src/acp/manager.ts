import { AcpClient, type AgentInfo } from "./client.js";
import {
  applyAgentDefaults,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  type AgentConfig,
} from "./config.js";
import { AcpError, ErrTooManyAgents } from "./errors.js";
import { spawnAgent, type AgentProcess } from "./process.js";

export interface AcpConn {
  client: AcpClient;
  process: AgentProcess;
  remoteSessionId: string;
  agentInfo: AgentInfo;
  protocolVersion: number;
  startedAt: Date;
  historyReplayed: boolean;
  stderrTail(): string;
}

export class AcpManager {
  private readonly conns = new Map<string, AcpConn>();
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT_AGENTS) {
    this.maxConcurrent = maxConcurrent > 0 ? maxConcurrent : DEFAULT_MAX_CONCURRENT_AGENTS;
  }

  async acquire(
    sessionId: string,
    agentConfig: AgentConfig,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<AcpConn> {
    const existing = this.conns.get(sessionId);
    if (existing) return existing;
    if (this.conns.size >= this.maxConcurrent) {
      throw new AcpError(ErrTooManyAgents, ErrTooManyAgents);
    }

    const cfg = applyAgentDefaults({ ...agentConfig, permission: { ...agentConfig.permission } });
    const proc = await spawnAgent(cfg, cwd, signal);
    const client = new AcpClient(proc, cfg);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("ACP initialize timeout")), cfg.init_timeout_ms);
    const composite = signal ? anySignal([signal, controller.signal]) : controller.signal;
    try {
      const init = await client.initialize(composite);
      const remoteSessionId = await client.newSession(cwd, composite);
      const conn: AcpConn = {
        client,
        process: proc,
        remoteSessionId,
        agentInfo: init.agentInfo,
        protocolVersion: init.protocolVersion,
        startedAt: new Date(),
        historyReplayed: false,
        stderrTail: () => proc.stderrTail(),
      };
      this.conns.set(sessionId, conn);
      return conn;
    } catch (error) {
      await proc.terminate().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  hasCapacity(sessionId: string): boolean {
    if (this.conns.has(sessionId)) return true;
    return this.conns.size < this.maxConcurrent;
  }

  invalidate(sessionId: string): void {
    const conn = this.conns.get(sessionId);
    if (!conn) return;
    this.conns.delete(sessionId);
    void conn.process.terminate().catch(() => {});
  }

  closeSession(sessionId: string): void {
    this.invalidate(sessionId);
  }

  closeAll(): void {
    const conns = [...this.conns.values()];
    this.conns.clear();
    for (const conn of conns) {
      void conn.process.terminate().catch(() => {});
    }
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
