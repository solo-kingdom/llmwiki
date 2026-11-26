import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client, DEFAULT_MAX_RATE_LIMIT_RETRIES, classifyError, type LLMRetryInfo } from "./client.js";
import type { LLMConfig, StreamEvent } from "./types.js";

interface FakeServer {
  baseUrl: string;
  readonly requests: number;
  close(): Promise<void>;
}

const servers: FakeServer[] = [];

function okJson(res: ServerResponse, content: string): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}

function sse(res: ServerResponse, deltas: string[], finish = true): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
  }
  if (finish) {
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    res.end("data: [DONE]\n\n");
  }
}

async function startServer(
  handler: (res: ServerResponse, req: IncomingMessage, index: number) => void,
): Promise<FakeServer> {
  const state = { requests: 0, baseUrl: "" };
  const server: Server = createServer((req, res) => {
    state.requests += 1;
    req.resume();
    handler(res, req, state.requests);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const fake: FakeServer = {
    get baseUrl() {
      return state.baseUrl;
    },
    get requests() {
      return state.requests;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(fake);
  return fake;
}

function clientFor(baseUrl: string, overrides: Partial<LLMConfig> = {}): Client {
  return new Client({
    provider: "openai",
    baseUrl,
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 10_000,
    streamIdleTimeoutMs: 60_000,
    retryBaseDelayMs: 2,
    retryCapDelayMs: 8,
    retryAfterCapMs: 40,
    ...overrides,
  });
}

async function collect(stream: AsyncGenerator<StreamEvent>): Promise<{ text: string; events: StreamEvent[] }> {
  const events: StreamEvent[] = [];
  let text = "";
  for await (const event of stream) {
    events.push(event);
    if (event.type === "token") text += event.content ?? "";
  }
  return { text, events };
}

const MESSAGES = [{ role: "user" as const, content: "hello" }];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("LLM client error classification", () => {
  it("keeps the historical messages and adds a retry kind", () => {
    expect(classifyError(429, "slow down").message).toBe("rate limit exceeded (HTTP 429): slow down");
    expect(classifyError(429, "").kind).toBe("rate_limit");
    expect(classifyError(500, "").kind).toBe("transient");
    expect(classifyError(503, "").message).toBe("server error (HTTP 503): ");
    expect(classifyError(408, "").kind).toBe("transient");
    expect(classifyError(401, "").kind).toBe("fatal");
    expect(classifyError(400, "max_tokens").message).toBe("context length exceeded (HTTP 400): max_tokens");
    expect(classifyError(400, "odd").kind).toBe("fatal");
  });
});

describe("LLM client retries (non-streaming chat)", () => {
  it("retries a rate-limited request until it succeeds and reports each backoff", async () => {
    const server = await startServer((res, _req, index) => {
      if (index <= 2) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end('{"error":"rate limit"}');
        return;
      }
      okJson(res, "ok");
    });
    const retries: LLMRetryInfo[] = [];
    const client = clientFor(server.baseUrl);
    client.onRetry = (info) => retries.push(info);

    const result = await client.chat(MESSAGES, null, 0.1, 256);

    expect(result.content).toBe("ok");
    expect(server.requests).toBe(3);
    expect(retries.map((info) => [info.kind, info.status, info.attempt])).toEqual([
      ["rate_limit", 429, 1],
      ["rate_limit", 429, 2],
    ]);
  });

  it("waits for Retry-After but caps the wait", async () => {
    const server = await startServer((res, _req, index) => {
      if (index === 1) {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "5" });
        res.end("busy");
        return;
      }
      okJson(res, "ok");
    });
    const client = clientFor(server.baseUrl, { retryAfterCapMs: 60 });
    const started = Date.now();

    await client.chat(MESSAGES, null, 0.1, 256);

    const elapsed = Date.now() - started;
    expect(server.requests).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(1500);
  });

  it("retries a server error with the transient budget, then gives up", async () => {
    const server = await startServer((res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("boom");
    });
    const client = clientFor(server.baseUrl);

    await expect(client.chat(MESSAGES, null, 0.1, 256)).rejects.toThrow("server error (HTTP 500)");
    expect(server.requests).toBe(4);
  });

  it("spends the larger budget on rate limits", async () => {
    const server = await startServer((res) => {
      res.writeHead(429);
      res.end();
    });
    const client = clientFor(server.baseUrl);

    await expect(client.chat(MESSAGES, null, 0.1, 256)).rejects.toThrow("rate limit exceeded");
    expect(server.requests).toBe(DEFAULT_MAX_RATE_LIMIT_RETRIES + 1);
  });

  it("does not retry authentication errors", async () => {
    const server = await startServer((res) => {
      res.writeHead(401);
      res.end("bad key");
    });
    const client = clientFor(server.baseUrl);

    await expect(client.chat(MESSAGES, null, 0.1, 256)).rejects.toThrow("authentication error (HTTP 401)");
    expect(server.requests).toBe(1);
  });

  it("stops retrying when the caller aborts", async () => {
    const controller = new AbortController();
    const server = await startServer((res) => {
      res.writeHead(429);
      res.end();
      controller.abort(new Error("stop requested"));
    });
    const client = clientFor(server.baseUrl);

    await expect(client.chat(MESSAGES, null, 0.1, 256, {}, controller.signal)).rejects.toThrow("stop requested");
    expect(server.requests).toBe(1);
  });
});

describe("LLM client retries (streaming)", () => {
  it("retries a rate-limited stream and returns the content", async () => {
    const server = await startServer((res, _req, index) => {
      if (index === 1) {
        res.writeHead(429);
        res.end();
        return;
      }
      sse(res, ["hel", "lo"]);
    });

    const { text, events } = await collect(clientFor(server.baseUrl).streamChat(MESSAGES, 0.1, 256));

    expect(text).toBe("hello");
    expect(events.at(-1)?.type).toBe("done");
    expect(server.requests).toBe(2);
  });

  it("retries a connection that drops before producing anything", async () => {
    const server = await startServer((res, req, index) => {
      if (index === 1) {
        req.socket.destroy();
        return;
      }
      sse(res, ["sec", "ond"]);
    });

    const { text } = await collect(clientFor(server.baseUrl).streamChat(MESSAGES, 0.1, 256));

    expect(text).toBe("second");
    expect(server.requests).toBe(2);
  });

  it("does not retry a stream that already delivered content", async () => {
    const server = await startServer((res) => {
      sse(res, ["partial"], false);
      setTimeout(() => res.destroy(), 20);
    });
    const client = clientFor(server.baseUrl);
    const retries: LLMRetryInfo[] = [];
    client.onRetry = (info) => retries.push(info);

    const { text, events } = await collect(client.streamChat(MESSAGES, 0.1, 256));

    expect(text).toBe("partial");
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(last?.error?.message).toMatch(/^stream read error:/);
    expect(retries).toEqual([]);
    expect(server.requests).toBe(1);
  });

  it("cuts a stalled stream at the idle timeout", async () => {
    let closed: Promise<void> = Promise.resolve();
    const server = await startServer((res) => {
      closed = new Promise((resolve) => res.on("close", () => resolve()));
      sse(res, ["one"], false);
    });
    const started = Date.now();

    const { text, events } = await collect(
      clientFor(server.baseUrl, { streamIdleTimeoutMs: 80 }).streamChat(MESSAGES, 0.1, 256),
    );

    expect(text).toBe("one");
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(last?.error?.message).toMatch(/^stream read error: stream idle timeout: no data for 80 ms$/);
    expect(Date.now() - started).toBeLessThan(5000);
    await closed;
    expect(server.requests).toBe(1);
  });

  it("retries a stream that stalls before its first event", async () => {
    const server = await startServer((res, _req, index) => {
      if (index === 1) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.flushHeaders();
        return;
      }
      sse(res, ["fresh"]);
    });
    const client = clientFor(server.baseUrl, { streamIdleTimeoutMs: 60 });
    const retries: LLMRetryInfo[] = [];
    client.onRetry = (info) => retries.push(info);

    const { text } = await collect(client.streamChat(MESSAGES, 0.1, 256));

    expect(text).toBe("fresh");
    expect(server.requests).toBe(2);
    expect(retries.map((info) => info.kind)).toEqual(["transient"]);
  });
});
