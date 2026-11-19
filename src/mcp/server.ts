import { createInterface } from "node:readline";
import {
  defaultToolPolicy,
  toolPolicyAllows,
  toolPolicyFilter,
  type ToolPolicy,
} from "./policy.js";
import type { JSONRPCRequest, JSONRPCResponse, Tool, ToolCallParams, ToolHandler } from "./types.js";

export interface AuditDb {
  recordMcpToolCall(
    toolName: string,
    remoteAddr: string,
    clientAgent: string,
    durationMs: number,
    status: string,
    errorType: string,
  ): void | Promise<void>;
}

export interface HttpAudit {
  remoteAddr: string;
  clientAgent: string;
  userAgent: string;
}

export class McpServer {
  private readonly tools: Tool[] = [];
  private readonly handlers = new Map<string, ToolHandler>();
  private policy: ToolPolicy = defaultToolPolicy(false);
  private auditDb: AuditDb | null = null;

  constructor(
    private readonly name: string,
    private readonly instructions: string,
  ) {}

  setToolPolicy(policy: ToolPolicy): void {
    this.policy = policy;
  }

  getToolPolicy(): ToolPolicy {
    return this.policy;
  }

  setAuditDb(db: AuditDb): void {
    this.auditDb = db;
  }

  registerTool(tool: Tool, handler: ToolHandler): void {
    this.tools.push(tool);
    this.handlers.set(tool.name, handler);
  }

  async runStdio(): Promise<void> {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let request: JSONRPCRequest;
      try {
        request = JSON.parse(line) as JSONRPCRequest;
      } catch {
        continue;
      }
      const response = await this.handleRequest(request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }

  async handleHttp(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse(
        { jsonrpc: "2.0", error: { code: -32600, message: "Method not allowed" } },
        405,
      );
    }
    let body: JSONRPCRequest;
    try {
      body = (await request.json()) as JSONRPCRequest;
    } catch {
      return jsonResponse(
        { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } },
        400,
      );
    }
    const userAgent = request.headers.get("user-agent") ?? "";
    const audit: HttpAudit = {
      remoteAddr: request.headers.get("x-forwarded-for") ?? "",
      clientAgent: request.headers.get("mcp-client-name") ?? (userAgent.length > 100 ? userAgent.slice(0, 100) : userAgent),
      userAgent,
    };
    const response = await this.handleRequest(body, audit);
    if (!response) return new Response(null, { status: 204 });
    return jsonResponse(response, 200);
  }

  async handleRequest(
    request: JSONRPCRequest,
    audit?: HttpAudit,
  ): Promise<JSONRPCResponse | null> {
    switch (request.method) {
      case "initialize":
        return this.handleInitialize(request);
      case "notifications/initialized":
        return null;
      case "tools/list":
        return this.handleToolsList(request);
      case "tools/call":
        return this.handleToolsCall(request, audit);
      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  }

  private handleInitialize(request: JSONRPCRequest): JSONRPCResponse {
    const defaultPolicy = this.policy.allowWriteTools ? "readwrite" : "readonly";
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: this.name, version: "0.1.0" },
        instructions: this.instructions,
        _meta: {
          accessModel: "rpc-first",
          transport: "http-post-jsonrpc",
          auth: "required-when-remote",
          defaultToolPolicy: defaultPolicy,
          compatibility:
            "First release focuses on RPC access via HTTP POST. Direct Claude Desktop stdio connection is not required.",
        },
      },
    };
  }

  private handleToolsList(request: JSONRPCRequest): JSONRPCResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { tools: toolPolicyFilter(this.policy, this.tools) },
    };
  }

  private async handleToolsCall(
    request: JSONRPCRequest,
    audit?: HttpAudit,
  ): Promise<JSONRPCResponse> {
    const params = (request.params ?? {}) as Partial<ToolCallParams>;
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};
    const handler = this.handlers.get(name);
    const allowed = handler !== undefined && toolPolicyAllows(this.policy, name);
    if (!allowed) {
      if (audit) {
        const errorType = handler ? "policy_denied" : "unknown_tool";
        await this.auditDb?.recordMcpToolCall(name, audit.remoteAddr, audit.clientAgent, 0, "denied", errorType);
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message: `Tool not found or disabled by policy: ${name}`,
        },
      };
    }

    const started = Date.now();
    try {
      const result = await handler(args);
      if (audit) {
        await this.auditDb?.recordMcpToolCall(
          name,
          audit.remoteAddr,
          audit.clientAgent,
          Date.now() - started,
          "success",
          "",
        );
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: result }], isError: false },
      };
    } catch (error) {
      if (audit) {
        await this.auditDb?.recordMcpToolCall(
          name,
          audit.remoteAddr,
          audit.clientAgent,
          Date.now() - started,
          "failure",
          "execution_error",
        );
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: `Error: ${errorMessage(error)}` }],
          isError: true,
        },
      };
    }
  }
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
