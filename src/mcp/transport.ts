import { DEFAULT_TIMEOUT_MS, type ServerConfig } from "./config.js";
import type { JSONRPCRequest, JSONRPCResponse, Tool, ToolCallParams } from "./types.js";

export interface Transport {
  listTools(signal?: AbortSignal): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

export async function newTransport(server: ServerConfig): Promise<Transport> {
  switch (server.transport) {
    case "sse":
      return new SseTransport(server);
    case "streamable-http":
      return new StreamableHttpTransport(server);
    case "stdio":
      return new StdioTransport(server);
    default:
      throw new Error(`unsupported transport ${JSON.stringify(server.transport)}`);
  }
}

let rpcId = 0;

class StreamableHttpTransport implements Transport {
  constructor(private readonly server: ServerConfig) {}

  async listTools(signal?: AbortSignal): Promise<Tool[]> {
    return parseToolsListResult(await this.rpc("tools/list", undefined, signal));
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const result = await this.rpc("tools/call", { name, arguments: args }, signal);
    return parseToolCallResult(result);
  }

  async close(): Promise<void> {}

  private async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = ++rpcId;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const response = await fetchWithTimeout(
      this.server.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.server.headers ?? {}),
        },
        body: JSON.stringify(request),
      },
      this.server.timeout_ms,
      signal,
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error(`mcp auth failed (HTTP ${response.status})`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`mcp HTTP ${response.status}: ${truncateStr(text, 200)}`);
    }
    let body: JSONRPCResponse;
    try {
      body = JSON.parse(text) as JSONRPCResponse;
    } catch (error) {
      throw new Error(`mcp invalid response: ${errorMessage(error)}`);
    }
    if (body.error) throw new Error(`mcp rpc error ${body.error.code}: ${body.error.message}`);
    return body.result;
  }
}

class SseTransport implements Transport {
  private postUrl = "";

  constructor(private readonly server: ServerConfig) {}

  async listTools(signal?: AbortSignal): Promise<Tool[]> {
    return parseToolsListResult(await this.rpc("tools/list", undefined, signal));
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return parseToolCallResult(await this.rpc("tools/call", { name, arguments: args }, signal));
  }

  async close(): Promise<void> {}

  private async ensureEndpoint(signal?: AbortSignal): Promise<void> {
    if (this.postUrl) return;
    const controller = timeoutController(this.server.timeout_ms, signal);
    try {
      const response = await fetch(this.server.url, {
        headers: { Accept: "text/event-stream", ...(this.server.headers ?? {}) },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(`mcp auth failed (HTTP ${response.status})`);
      }
      if (!response.ok) {
        throw new Error(`mcp SSE connect HTTP ${response.status}: ${truncateStr(await response.text(), 200)}`);
      }
      if (!response.body) throw new Error("mcp SSE: empty body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("event: ")) {
            eventType = line.slice("event: ".length);
          } else if (line.startsWith("data: ")) {
            if (eventType === "endpoint") {
              this.postUrl = line.slice("data: ".length).trim();
              await reader.cancel();
              return;
            }
          } else if (line === "") {
            eventType = "";
          }
          newline = buffer.indexOf("\n");
        }
      }
      throw new Error("mcp SSE: endpoint not received");
    } finally {
      controller.cancel();
    }
  }

  private async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    await this.ensureEndpoint(signal);
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: ++rpcId,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const response = await fetchWithTimeout(
      this.postUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.server.headers ?? {}) },
        body: JSON.stringify(request),
      },
      this.server.timeout_ms,
      signal,
    );
    const text = await response.text();
    let body: JSONRPCResponse;
    try {
      body = JSON.parse(text) as JSONRPCResponse;
    } catch (error) {
      throw new Error(`mcp invalid response: ${errorMessage(error)}`);
    }
    if (body.error) throw new Error(`mcp rpc error ${body.error.code}: ${body.error.message}`);
    return body.result;
  }
}

class StdioTransport implements Transport {
  constructor(private readonly server: ServerConfig) {}

  async listTools(): Promise<Tool[]> {
    throw new Error(`stdio transport is not implemented for server ${JSON.stringify(this.server.id)}`);
  }

  async callTool(): Promise<string> {
    throw new Error(`stdio transport is not implemented for server ${JSON.stringify(this.server.id)}`);
  }

  async close(): Promise<void> {}
}

export function parseToolsListResult(raw: unknown): Tool[] {
  if (!raw || typeof raw !== "object") return [];
  const tools = (raw as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools.filter(isTool);
}

function isTool(value: unknown): value is Tool {
  if (!value || typeof value !== "object") return false;
  const tool = value as Record<string, unknown>;
  return typeof tool["name"] === "string";
}

export function parseToolCallResult(raw: unknown): string {
  if (!raw || typeof raw !== "object") return stringifyRaw(raw);
  const result = raw as {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  if (!Array.isArray(result.content)) return stringifyRaw(raw);
  const text = result.content
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
  if (result.isError) throw new Error(`tool returned error: ${text}`);
  return text;
}

function stringifyRaw(raw: unknown): string {
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = timeoutController(timeoutMs, signal);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.expired) throw new Error(`mcp timeout: ${errorMessage(error)}`);
    throw error;
  } finally {
    controller.cancel();
  }
}

function timeoutController(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new Error("mcp timeout"));
  }, timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    get expired() {
      return expired;
    },
    cancel() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function truncateStr(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
