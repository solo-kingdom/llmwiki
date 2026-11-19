import { AcpClient } from "./client.js";
import {
  applyAgentDefaults,
  type AcpConfig,
  type AgentConfig,
} from "./config.js";
import { resolveCwd } from "./cwd.js";
import { ErrProtocolVersionUnsupported } from "./errors.js";
import { lookPath, spawnAgent } from "./process.js";

export interface AgentCheckResult {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  code?: string;
  message?: string;
  agent_name?: string;
  agent_version?: string;
  protocol_version?: number;
}

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
}

export async function checkAgents(
  cfg: AcpConfig | null | undefined,
  workspace: string,
  signal?: AbortSignal,
): Promise<AgentCheckResult[]> {
  if (!cfg || Object.keys(cfg.agents).length === 0) return [];
  const results: AgentCheckResult[] = [];
  for (const id of sortedAgentIds(cfg.agents)) {
    results.push(await checkAgent(cfg.agents[id]!, workspace, signal));
  }
  return results;
}

async function checkAgent(
  agent: AgentConfig,
  workspace: string,
  signal?: AbortSignal,
): Promise<AgentCheckResult> {
  const result: AgentCheckResult = {
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
    status: "",
  };
  if (!agent.enabled) {
    result.status = "disabled";
    result.message = "已禁用";
    return result;
  }
  if (!(await lookPath(agent.command))) {
    result.status = "error";
    result.code = "cli_not_found";
    result.message = `命令 ${agent.command} 未找到（PATH 中不可用）`;
    return result;
  }

  const cfg = applyAgentDefaults({ ...agent, permission: { ...agent.permission } });
  const timeout = Math.min(cfg.init_timeout_ms, 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("ACP probe timeout")), timeout);
  const composite = signal ? anySignal([signal, controller.signal]) : controller.signal;
  try {
    let cwd: string;
    try {
      cwd = await resolveCwd(workspace, "probe", cfg.cwd_policy);
    } catch (error) {
      result.status = "error";
      result.code = "cwd_invalid";
      result.message = errorMessage(error);
      return result;
    }

    let proc;
    try {
      proc = await spawnAgent(cfg, cwd, composite);
    } catch (error) {
      result.status = "error";
      result.code = "spawn_failed";
      result.message = errorMessage(error);
      return result;
    }

    try {
      const client = new AcpClient(proc, cfg);
      const init = await client.initialize(composite);
      result.status = "ok";
      result.code = "ok";
      result.message = "连接正常";
      result.agent_name = init.agentInfo.name;
      result.agent_version = init.agentInfo.version;
      result.protocol_version = init.protocolVersion;
      return result;
    } catch (error) {
      result.status = "error";
      result.code = isProtocolError(error) ? "protocol_version_unsupported" : "initialize_failed";
      result.message = errorMessage(error);
      return result;
    } finally {
      await proc.terminate().catch(() => {});
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function availability(cfg: AcpConfig | null | undefined): Promise<Record<string, AvailabilityResult>> {
  const out: Record<string, AvailabilityResult> = {};
  if (!cfg) return out;
  for (const agent of Object.values(cfg.agents)) {
    if (!(await lookPath(agent.command))) {
      out[agent.id] = {
        available: false,
        reason: `命令 ${agent.command} 未找到（PATH 中不可用）`,
      };
      continue;
    }
    out[agent.id] = { available: true };
  }
  return out;
}

function sortedAgentIds(agents: Record<string, AgentConfig>): string[] {
  return Object.keys(agents).sort();
}

function isProtocolError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(ErrProtocolVersionUnsupported);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
