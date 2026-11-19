import type { McpConfig, ServerConfig } from "./config.js";
import { filterTools } from "./policy.js";
import { newTransport } from "./transport.js";

const CHECK_TIMEOUT_MS = 10000;

export interface ServerCheckResult {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  message?: string;
  tool_count?: number;
}

export async function checkServers(
  cfg: McpConfig | null,
  signal?: AbortSignal,
): Promise<ServerCheckResult[]> {
  if (!cfg || Object.keys(cfg.servers).length === 0) return [];
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("mcp check timeout")),
    CHECK_TIMEOUT_MS * Object.keys(cfg.servers).length,
  );
  const composite = signal ? anySignal([signal, controller.signal]) : controller.signal;
  try {
    const results: ServerCheckResult[] = [];
    for (const server of Object.values(cfg.servers)) {
      results.push(await checkServer(cfg, server, composite));
    }
    return results;
  } finally {
    clearTimeout(timer);
  }
}

async function checkServer(
  cfg: McpConfig,
  server: ServerConfig,
  signal: AbortSignal,
): Promise<ServerCheckResult> {
  const result: ServerCheckResult = {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    status: "",
  };
  if (!server.enabled) {
    result.status = "disabled";
    result.message = "已禁用";
    return result;
  }
  if (server.transport === "stdio") {
    result.status = "error";
    result.message = "stdio transport 暂不支持连接检查";
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("mcp check timeout")), CHECK_TIMEOUT_MS);
  const composite = anySignal([signal, controller.signal]);
  try {
    const transport = await newTransport(server);
    try {
      const tools = await transport.listTools(composite);
      const filtered = filterTools(tools, cfg, server);
      result.status = "ok";
      result.tool_count = filtered.length;
      result.message =
        filtered.length === 0 ? "连接正常，但无可用工具" : `连接正常，${filtered.length} 个可用工具`;
      return result;
    } finally {
      await transport.close().catch(() => {});
    }
  } catch (error) {
    result.status = "error";
    result.message = errorMessage(error);
    return result;
  } finally {
    clearTimeout(timer);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
