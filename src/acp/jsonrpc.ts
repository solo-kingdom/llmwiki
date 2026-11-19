import { createInterface } from "node:readline";
import type { AgentProcess } from "./process.js";

const RPC_MAX_LINE_BYTES = 1024 * 1024;

interface RpcMessage {
  jsonrpc?: string;
  method?: string;
  id?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingCall {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export type NotificationHandler = (method: string, params: unknown) => void;
export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;

const ERR_METHOD_NOT_FOUND = "JSON-RPC method not found";

export class JsonRpcConn {
  private writeChain: Promise<void> = Promise.resolve();
  private nextId = 0;
  private readonly pending = new Map<number, PendingCall>();
  private readError: Error | null = null;
  private closed = false;
  private notificationHandler: NotificationHandler | null = null;
  private requestHandler: RequestHandler | null = null;

  constructor(private readonly proc: AgentProcess) {
    void this.readLoop();
  }

  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  setRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  async call(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) throw this.currentReadError();
    const id = ++this.nextId;
    const payload = { jsonrpc: "2.0", method, id, ...(params === undefined ? {} : { params }) };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      if (signal) {
        const onAbort = () => {
          this.pending.delete(id);
          reject(abortError(signal));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    try {
      await this.write(payload);
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return promise;
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  private async readLoop(): Promise<void> {
    if (!this.proc.stdout) {
      this.fail(new Error("ACP process stdout is unavailable"));
      return;
    }
    const rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (Buffer.byteLength(line) > RPC_MAX_LINE_BYTES) {
          this.fail(new Error("decode ACP JSON-RPC message: line too long"));
          return;
        }
        if (!line.trim()) continue;
        let message: RpcMessage;
        try {
          message = JSON.parse(line) as RpcMessage;
        } catch (error) {
          this.fail(new Error(`decode ACP JSON-RPC message: ${errorMessage(error)}`));
          return;
        }
        if (!message.method && message.id !== undefined && message.id !== null) {
          this.dispatchResponse(message);
        } else if (message.method && (message.id === undefined || message.id === null)) {
          this.notificationHandler?.(message.method, message.params);
        } else if (message.method) {
          void this.dispatchRequest(message);
        } else {
          this.fail(new Error("invalid ACP JSON-RPC message"));
          return;
        }
      }
    } catch (error) {
      this.fail(new Error(`read ACP JSON-RPC stream: ${errorMessage(error)}`));
      return;
    }
    this.fail(new Error("EOF"));
  }

  private dispatchResponse(message: RpcMessage): void {
    const id = rpcIdNumber(message.id);
    if (id === null) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (message.error) {
      pending.reject(new Error(`ACP ${pending.method}: ${message.error.message}`));
      return;
    }
    pending.resolve(message.result);
  }

  private async dispatchRequest(message: RpcMessage): Promise<void> {
    const handler = this.requestHandler;
    if (!handler) {
      await this.writeResponse({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }
    try {
      const result = await handler(message.method ?? "", message.params);
      await this.writeResponse({ jsonrpc: "2.0", id: message.id, result: result ?? null });
    } catch (error) {
      const code = errorMessage(error) === ERR_METHOD_NOT_FOUND ? -32601 : -32603;
      await this.writeResponse({
        jsonrpc: "2.0",
        id: message.id,
        error: { code, message: errorMessage(error) },
      });
    }
  }

  private writeResponse(response: unknown): Promise<void> {
    return this.write(response);
  }

  private write(payload: unknown): Promise<void> {
    const line = `${JSON.stringify(payload)}\n`;
    this.writeChain = this.writeChain.then(() => this.proc.write(line));
    return this.writeChain;
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.readError = error;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const call of pending) {
      call.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  currentReadError(): Error {
    return this.readError ?? new Error("EOF");
  }
}

export function methodNotFound(): Error {
  return new Error(ERR_METHOD_NOT_FOUND);
}

export function rpcIdNumber(id: unknown): number | null {
  if (typeof id === "number" && Number.isInteger(id)) return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number.parseInt(id, 10);
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}
