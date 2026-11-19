export interface JSONRPCRequest {
  jsonrpc: string;
  id?: unknown;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: string;
  id?: unknown;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

export type ToolHandler = (
  args: Record<string, unknown>,
) => string | Promise<string>;
