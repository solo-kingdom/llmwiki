import type { Store } from "../store/interfaces.js";
import type { IngestSession } from "../store/types.js";
import {
  AgentRuntimeError,
  ERR_ACP_AGENT_DISABLED,
  ERR_ACP_CLI_NOT_FOUND,
  ERR_ACP_CONFIG_INVALID,
  ERR_NO_ACP_AGENT,
  KIND_ACP,
  type Runtime,
} from "./runtime.js";

export interface AcpAgentView {
  name: string;
  enabled: boolean;
  command: string;
  cwdPolicy: string;
  promptTimeoutMs: number;
  fullAgent?: unknown;
}

export interface AcpConfigView {
  agent(id: string): AcpAgentView | undefined;
  fullConfig?: unknown;
}

/**
 * Native and ACP runtime implementations arrive with the ingest (S5) and acp/mcp
 * (S6) layers. Until then Resolve takes them as ports so the session routing logic
 * and error semantics can be migrated independently.
 */
export interface AgentRuntimePorts {
  parseAcpConfig(raw: string): AcpConfigView;
  lookPath(command: string): Promise<string | null>;
  createAcpRuntime(
    manager: unknown,
    workspace: string,
    config: AcpConfigView,
    agent: AcpAgentView,
  ): Runtime;
  createNativeRuntime(
    db: Store,
    workspace: string,
    session: IngestSession | null,
  ): Promise<Runtime>;
}

export async function resolveRuntime(
  db: Store,
  workspace: string,
  manager: unknown,
  session: IngestSession | null,
  ports: AgentRuntimePorts,
): Promise<Runtime> {
  if (session && session.agent_kind.toLowerCase() === KIND_ACP) {
    let raw: string;
    try {
      raw = await db.getConfig("acp_agents_json");
    } catch (error) {
      throw new AgentRuntimeError(
        ERR_ACP_CONFIG_INVALID,
        `ACP config invalid: ${errorMessage(error)}`,
      );
    }

    let config: AcpConfigView;
    try {
      config = ports.parseAcpConfig(raw);
    } catch (error) {
      throw new AgentRuntimeError(
        ERR_ACP_CONFIG_INVALID,
        `ACP config invalid: ${errorMessage(error)}`,
      );
    }

    const agent = config.agent(session.acp_agent_id);
    if (!agent) {
      throw new AgentRuntimeError(
        ERR_NO_ACP_AGENT,
        `no ACP agent: agent "${session.acp_agent_id}" is not configured`,
      );
    }
    if (!agent.enabled) {
      throw new AgentRuntimeError(ERR_ACP_AGENT_DISABLED, `ACP agent disabled: ${agent.name}`);
    }
    if (!(await ports.lookPath(agent.command))) {
      throw new AgentRuntimeError(ERR_ACP_CLI_NOT_FOUND, `ACP CLI not found: ${agent.command}`);
    }
    if (!manager) {
      throw new AgentRuntimeError(
        ERR_ACP_CONFIG_INVALID,
        "ACP config invalid: ACP manager is unavailable",
      );
    }
    return ports.createAcpRuntime(manager, workspace, config, agent);
  }
  return ports.createNativeRuntime(db, workspace, session);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
