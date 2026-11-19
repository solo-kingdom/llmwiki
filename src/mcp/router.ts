import type { McpConfig, ServerConfig } from "./config.js";
import { filterTools, isToolCallAllowed } from "./policy.js";
import type { McpRegistry } from "./registry.js";
import { newTransport } from "./transport.js";
import type { Tool } from "./types.js";

export interface EventRecorder {
  recordMCP(step: string, phase: string, message: string, payload: Record<string, unknown> | null): void;
}

export class McpRouter {
  constructor(
    private readonly registry: McpRegistry,
    private readonly recorder: EventRecorder | null = null,
  ) {}

  hasJobServers(): boolean {
    return this.registry.jobServers().length > 0;
  }

  hasChatServers(): boolean {
    return this.registry.chatServers().length > 0;
  }

  async listToolsForJob(signal?: AbortSignal): Promise<Tool[]> {
    return this.listToolsForServers(this.registry.jobServers(), true, signal);
  }

  async listToolsForChat(signal?: AbortSignal): Promise<Tool[]> {
    return this.listToolsForServers(this.registry.chatServers(), false, signal);
  }

  chatToolAllowed(toolName: string): boolean {
    const cfg = this.registry.config();
    return this.registry.chatServers().some((server) => isToolCallAllowed(cfg, server, toolName));
  }

  async callToolForChat(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ result: string; localOnly: boolean }> {
    return this.callToolOnServers(this.registry.chatServers(), toolName, args, false, signal);
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ result: string; localOnly: boolean }> {
    return this.callToolOnServers(this.registry.jobServers(), toolName, args, true, signal);
  }

  private async listToolsForServers(
    servers: ServerConfig[],
    record: boolean,
    signal?: AbortSignal,
  ): Promise<Tool[]> {
    const cfg = this.registry.config();
    const all: Tool[] = [];
    let lastError: unknown = null;
    for (const server of servers) {
      if (record) {
        this.record("mcp", "mcp_tools_list_started", "listing tools", { server_id: server.id });
      }
      try {
        const tools = await this.listToolsOnServer(cfg, server, signal);
        if (record) {
          this.record("mcp", "mcp_tools_list_completed", "tools listed", {
            server_id: server.id,
            count: tools.length,
          });
        }
        all.push(...tools);
      } catch (error) {
        lastError = error;
        if (record) {
          this.record("mcp", "mcp_tools_list_failed", errorMessage(error), {
            server_id: server.id,
          });
        }
      }
    }
    if (all.length === 0 && lastError) throw lastError;
    return dedupeTools(all);
  }

  private async listToolsOnServer(
    cfg: McpConfig,
    server: ServerConfig,
    signal?: AbortSignal,
  ): Promise<Tool[]> {
    const attempts = Math.max(1, server.retry.max + 1);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await delay(server.retry.backoff_ms);
      let transport;
      try {
        transport = await newTransport(server);
        const tools = await transport.listTools(signal);
        return filterTools(tools, cfg, server);
      } catch (error) {
        lastError = error;
      } finally {
        await transport?.close().catch(() => {});
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async callToolOnServers(
    servers: ServerConfig[],
    toolName: string,
    args: Record<string, unknown>,
    record: boolean,
    signal?: AbortSignal,
  ): Promise<{ result: string; localOnly: boolean }> {
    if (servers.length === 0) return { result: "", localOnly: true };
    const cfg = this.registry.config();
    let lastError: unknown = null;
    for (const server of servers) {
      if (!isToolCallAllowed(cfg, server, toolName)) {
        lastError = new Error(`tool ${JSON.stringify(toolName)} not allowed on server ${JSON.stringify(server.id)}`);
        continue;
      }
      if (record) {
        this.record("mcp", "mcp_tool_call_started", "calling tool", {
          server_id: server.id,
          tool: toolName,
        });
      }
      try {
        const result = await this.callOnServer(cfg, server, toolName, args, signal);
        if (record) {
          this.record("mcp", "mcp_tool_call_completed", "tool call ok", {
            server_id: server.id,
            tool: toolName,
          });
        }
        return { result, localOnly: false };
      } catch (error) {
        lastError = error;
        if (record) {
          this.record("mcp", "mcp_tool_call_failed", errorMessage(error), {
            server_id: server.id,
            tool: toolName,
          });
        }
      }
    }
    if (record) {
      this.record("mcp", "mcp_degraded", "all MCP servers failed; falling back to local_only", {
        tool: toolName,
        error: errorMessage(lastError),
      });
      this.record("mcp", "mcp_fallback_local_only", "disabled tool calls for remainder", null);
    }
    void lastError;
    return { result: "", localOnly: true };
  }

  private async callOnServer(
    cfg: McpConfig,
    server: ServerConfig,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const attempts = Math.max(1, server.retry.max + 1);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await delay(server.retry.backoff_ms);
      let transport;
      try {
        transport = await newTransport(server);
        if (!isToolCallAllowed(cfg, server, toolName)) {
          throw new Error(`tool ${JSON.stringify(toolName)} not allowed`);
        }
        return await transport.callTool(toolName, args, signal);
      } catch (error) {
        lastError = error;
      } finally {
        await transport?.close().catch(() => {});
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private record(
    step: string,
    phase: string,
    message: string,
    payload: Record<string, unknown> | null,
  ): void {
    this.recorder?.recordMCP(step, phase, message, payload);
  }
}

export function dedupeTools(tools: Tool[]): Tool[] {
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const tool of tools) {
    const key = tool.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tool);
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
