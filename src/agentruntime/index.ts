import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { parseConfig, type AcpConfig } from "../acp/config.js";
import type { AcpManager } from "../acp/manager.js";
import type { Store } from "../store/interfaces.js";
import type { IngestSession } from "../store/types.js";
import { newAcpRuntime } from "./acp.js";
import { createNativeRuntime } from "./native.js";
import {
  resolveRuntime,
  type AcpAgentView,
  type AcpConfigView,
  type AgentRuntimePorts,
} from "./resolve.js";
import type { Runtime } from "./runtime.js";

export function parseAcpConfigView(raw: string): AcpConfigView {
  const config: AcpConfig = parseConfig(raw);
  return {
    fullConfig: config,
    agent(id: string): AcpAgentView | undefined {
      const agent = config.agents[id];
      if (!agent) return undefined;
      return {
        name: agent.name,
        enabled: agent.enabled,
        command: agent.command,
        cwdPolicy: agent.cwd_policy,
        promptTimeoutMs: agent.prompt_timeout_ms,
        fullAgent: agent,
      };
    },
  };
}

export async function lookPath(command: string): Promise<string | null> {
  const value = command.trim();
  if (!value) return null;
  if (value.includes("/") || value.includes(path.sep)) {
    try {
      await access(value, constants.X_OK);
      return value;
    } catch {
      return null;
    }
  }
  const search = process.env.PATH ?? "";
  for (const dir of search.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, value);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}

export function defaultAgentRuntimePorts(): AgentRuntimePorts {
  return {
    parseAcpConfig: parseAcpConfigView,
    lookPath,
    createAcpRuntime(manager, workspace, config, agent) {
      const fullConfig = (config.fullConfig as AcpConfig | undefined) ?? parseConfig("{}");
      const fullAgent = (agent.fullAgent as AcpConfig["agents"][string] | undefined) ?? {
        id: agent.name,
        name: agent.name,
        enabled: agent.enabled,
        command: agent.command,
        cwd_policy: agent.cwdPolicy,
        init_timeout_ms: 30_000,
        prompt_timeout_ms: agent.promptTimeoutMs,
        idle_timeout_ms: 120_000,
        permission: {
          mode: "readonly",
          allow_read: true,
          allow_search: true,
          allow_fetch: true,
          allow_write: false,
          allow_execute: false,
        },
      };
      return newAcpRuntime(manager as AcpManager, workspace, fullConfig, fullAgent);
    },
    createNativeRuntime,
  };
}

export async function resolveDefaultRuntime(
  db: Store,
  workspace: string,
  manager: unknown,
  session: IngestSession | null,
): Promise<Runtime> {
  return resolveRuntime(db, workspace, manager, session, defaultAgentRuntimePorts());
}

export * from "./runtime.js";
export * from "./resolve.js";
export { AcpRuntime, newAcpRuntime } from "./acp.js";
export { NativeRuntime, createNativeRuntime, sessionChatRouter } from "./native.js";
