import type {
  ChatOptions,
  ChatResult,
  LLMConfig,
  Message,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 15 * 1000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_RATE_LIMIT_RETRIES = 6;
export const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;
export const DEFAULT_RETRY_CAP_DELAY_MS = 30_000;
export const DEFAULT_RETRY_AFTER_CAP_MS = 120_000;

export type LLMFailureKind = "rate_limit" | "transient" | "fatal";

export interface LLMRetryInfo {
  kind: LLMFailureKind;
  status: number;
  attempt: number;
  delayMs: number;
}

/** A failed provider request. `kind` decides whether another attempt is worth waiting for. */
export class LLMRequestError extends Error {
  readonly kind: LLMFailureKind;
  readonly status: number;
  readonly retryAfterMs: number;

  constructor(message: string, kind: LLMFailureKind, status = 0, retryAfterMs = 0) {
    super(message);
    this.name = "LLMRequestError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function defaultLLMConfig(): LLMConfig {
  return {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKey: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  };
}

export class Client {
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly streamIdleTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRateLimitRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryCapDelayMs: number;
  private readonly retryAfterCapMs: number;
  /** Called before every retry; use it to make backoff visible in job events. */
  onRetry: ((info: LLMRetryInfo) => void) | null = null;

  constructor(config: LLMConfig) {
    this.provider = config.provider || "openai";
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.streamIdleTimeoutMs =
      config.streamIdleTimeoutMs > 0 ? config.streamIdleTimeoutMs : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    this.maxRetries = positiveOr(config.maxRetries, DEFAULT_MAX_RETRIES);
    this.maxRateLimitRetries = positiveOr(config.maxRateLimitRetries, DEFAULT_MAX_RATE_LIMIT_RETRIES);
    this.retryBaseDelayMs = positiveOr(config.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS);
    this.retryCapDelayMs = positiveOr(config.retryCapDelayMs, DEFAULT_RETRY_CAP_DELAY_MS);
    this.retryAfterCapMs = positiveOr(config.retryAfterCapMs, DEFAULT_RETRY_AFTER_CAP_MS);
  }

  validateRequest(): void {
    if (!this.model.trim()) throw new Error("model is not configured");
    const base = this.baseUrl.trim();
    if (!base) {
      throw new Error(
        "provider base URL is not configured; set it in Settings under Provider instances",
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new Error(
        `provider base URL must be a valid http(s) URL (got "${this.baseUrl}"); configure it in Settings`,
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `provider base URL must use http or https (got "${parsed.protocol.replace(/:$/, "")}")`,
      );
    }
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[] | null,
    temperature: number,
    maxTokens: number,
    options: ChatOptions = {},
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    this.validateRequest();
    const body = this.buildChatBody(
      messages,
      tools ?? [],
      temperature,
      maxTokens,
      false,
      options.toolChoice ?? "",
    );
    const response = await this.fetchWithRetry(
      signal,
      () =>
        fetch(this.buildUrl(), {
          method: "POST",
          headers: this.headers(),
          body,
          signal: this.requestSignal(signal),
        }),
    );
    return parseChatResponse(await response.text(), this.provider);
  }

  async *streamChat(
    messages: Message[],
    temperature: number,
    maxTokens: number,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    this.validateRequest();
    const body = this.buildChatBody(messages, [], temperature, maxTokens, true, "");
    const send = (): Promise<Response> =>
      fetch(this.buildUrl(), {
        method: "POST",
        headers: this.headers(),
        body,
        signal: this.requestSignal(signal),
      });

    for (let tries = 0; ; tries += 1) {
      let response: Response;
      try {
        response = await this.fetchWithRetry(signal, send);
      } catch (error) {
        yield { type: "error", error: requestFailure(error, signal) };
        return;
      }
      if (!response.body) {
        yield { type: "done" };
        return;
      }

      // Retrying after an event was delivered would duplicate output, so only a stream
      // that fails before producing anything gets another attempt.
      let delivered = false;
      try {
        for await (const event of this.readStream(response.body)) {
          delivered = true;
          yield event;
        }
        return;
      } catch (error) {
        const failure = requestFailure(error, signal);
        if (delivered || tries >= this.retryBudget(failure.kind)) {
          yield { type: "error", error: failure };
          return;
        }
        try {
          await this.backOff(failure, tries, signal);
        } catch (abortError) {
          yield { type: "error", error: requestFailure(abortError, signal) };
          return;
        }
      }
    }
  }

  async probe(signal?: AbortSignal): Promise<void> {
    this.validateRequest();
    const { url, method } = this.probeRequest();
    const response = await fetch(url, {
      method,
      headers: this.headers(),
      signal: this.requestSignal(signal, DEFAULT_PROBE_TIMEOUT_MS),
    });
    if (response.ok) return;
    const body = await response.text();
    throw classifyError(response.status, body);
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    this.validateRequest();
    const { url, method } = this.probeRequest();
    const response = await fetch(url, {
      method,
      headers: this.headers(),
      signal: this.requestSignal(signal, DEFAULT_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text();
      throw classifyError(response.status, body);
    }
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error("provider models endpoint returned non-JSON body");
    }
    return extractModelIds(payload, this.provider);
  }

  async embeddings(model: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
    if (input.length === 0) return [];
    const effectiveModel = model || this.model;
    const url = `${this.baseUrl.replace(/\/+$/, "")}/embeddings`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: effectiveModel, input }),
      signal: this.requestSignal(signal),
    });
    const data = await response.text();
    if (!response.ok) {
      throw new Error(`embeddings API returned ${response.status}: ${data.trim()}`);
    }
    let parsed: EmbeddingResponse;
    try {
      parsed = JSON.parse(data) as EmbeddingResponse;
    } catch (error) {
      throw new Error(`decode embeddings response: ${errorMessage(error)}`);
    }
    if (parsed.error) throw new Error(`embeddings API error: ${parsed.error.message}`);
    const items = parsed.data ?? [];
    if (items.length !== input.length) {
      throw new Error(`embeddings API returned ${items.length} vectors for ${input.length} inputs`);
    }
    const out: number[][] = new Array(items.length);
    items.forEach((item, index) => {
      const target = item.index >= 0 && item.index < out.length ? item.index : index;
      out[target] = item.embedding;
    });
    return out;
  }

  private probeRequest(): { url: string; method: string } {
    const base = this.baseUrl.replace(/\/+$/, "");
    switch (this.provider) {
      case "anthropic":
        return {
          url: /\/v\d+[^/]*$/.test(base) ? `${base}/models` : `${base}/v1/models`,
          method: "GET",
        };
      case "ollama":
        return { url: `${base}/api/tags`, method: "GET" };
      default:
        return { url: `${base}/models`, method: "GET" };
    }
  }

  private requestSignal(signal: AbortSignal | undefined, timeoutMs?: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs ?? this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /** Sends `attempt` until a 2xx response arrives, the retry budget is spent, or the caller aborts. */
  private async fetchWithRetry(
    signal: AbortSignal | undefined,
    attempt: () => Promise<Response>,
  ): Promise<Response> {
    for (let tries = 0; ; tries += 1) {
      let failure: LLMRequestError;
      try {
        const response = await attempt();
        if (response.ok) return response;
        failure = classifyError(response.status, await response.text(), retryAfterMs(response));
      } catch (error) {
        failure = requestFailure(error, signal);
      }
      if (tries >= this.retryBudget(failure.kind)) throw failure;
      await this.backOff(failure, tries, signal);
    }
  }

  private retryBudget(kind: LLMFailureKind): number {
    if (kind === "rate_limit") return this.maxRateLimitRetries;
    return kind === "transient" ? this.maxRetries : 0;
  }

  private retryDelay(failure: LLMRequestError, tries: number): number {
    if (failure.retryAfterMs > 0) return Math.min(this.retryAfterCapMs, failure.retryAfterMs);
    const ceiling =
      failure.kind === "rate_limit"
        ? this.retryCapDelayMs
        : Math.min(this.retryCapDelayMs, this.retryBaseDelayMs * 2 ** this.maxRetries);
    const base = Math.min(ceiling, this.retryBaseDelayMs * 2 ** tries);
    return Math.round(base * (0.5 + Math.random() / 2));
  }

  private async backOff(failure: LLMRequestError, tries: number, signal: AbortSignal | undefined): Promise<void> {
    const delayMs = this.retryDelay(failure, tries);
    this.onRetry?.({ kind: failure.kind, status: failure.status, attempt: tries + 1, delayMs });
    await sleep(delayMs, signal);
  }

  private readStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
    if (this.provider === "anthropic") return this.readSSEAnthropic(body, this.streamIdleTimeoutMs);
    if (this.provider === "ollama") return this.readJSONLines(body, this.streamIdleTimeoutMs);
    return this.readSSEOpenAI(body, this.streamIdleTimeoutMs);
  }

  private buildUrl(): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    switch (this.provider) {
      case "anthropic":
        return `${base}/messages`;
      case "ollama":
        return `${base}/api/chat`;
      default:
        return `${base}/chat/completions`;
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.provider === "anthropic") {
      if (this.apiKey) headers["x-api-key"] = this.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  buildChatBody(
    messages: Message[],
    tools: ToolDefinition[],
    temperature: number,
    maxTokens: number,
    stream: boolean,
    toolChoice: string,
  ): string {
    if (this.provider === "anthropic") {
      let systemText = "";
      const filtered: Message[] = [];
      for (const message of messages) {
        if (message.role === "system") {
          if (systemText) systemText += "\n\n";
          systemText += message.content ?? "";
        } else {
          filtered.push(message);
        }
      }
      const request: Record<string, unknown> = {
        model: this.model,
        messages: convertToAnthropicMessages(filtered),
        max_tokens: maxTokens > 0 ? maxTokens : 4096,
        stream,
      };
      if (systemText) request.system = systemText;
      if (tools.length > 0) {
        request.tools = tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters ?? { type: "object", properties: {} },
        }));
        if (toolChoice === "required") request.tool_choice = { type: "any" };
        else if (toolChoice === "auto") request.tool_choice = { type: "auto" };
      }
      return JSON.stringify(request);
    }

    if (this.provider === "ollama") {
      const request: Record<string, unknown> = {
        model: this.model,
        messages: toWireMessages(messages),
        stream,
      };
      if (tools.length > 0) {
        request.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters ?? { type: "object", properties: {} },
          },
        }));
      }
      return JSON.stringify(request);
    }

    const request: Record<string, unknown> = {
      model: this.model,
      messages: toWireMessages(messages),
      temperature,
      stream,
    };
    if (maxTokens > 0) request.max_tokens = maxTokens;
    if (this.baseUrl.includes("minimaxi.com")) {
      // MiniMax runs adaptive thinking by default and can spend the whole token
      // budget on reasoning, leaving empty visible content; keep reasoning small.
      request.reasoning_effort = "low";
    }
    if (tools.length > 0) {
      request.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: "object", properties: {} },
        },
      }));
    }
    if (toolChoice) request.tool_choice = { type: toolChoice };
    return JSON.stringify(request);
  }

  private async *readSSEOpenAI(
    body: ReadableStream<Uint8Array>,
    idleTimeoutMs: number,
  ): AsyncGenerator<StreamEvent> {
    for await (const rawLine of readLines(body, idleTimeoutMs)) {
      const line = rawLine.trim();
      if (!line || !line.startsWith("data: ")) continue;
      const data = line.slice("data: ".length);
      if (data === "[DONE]") {
        yield { type: "done" };
        return;
      }
      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data) as OpenAIStreamChunk;
      } catch {
        continue;
      }
      for (const choice of chunk.choices ?? []) {
        const content = choice?.delta?.content;
        if (content) yield { type: "token", content };
        if (choice?.finish_reason) {
          yield { type: "done" };
          return;
        }
      }
    }
    yield { type: "done" };
  }

  private async *readSSEAnthropic(
    body: ReadableStream<Uint8Array>,
    idleTimeoutMs: number,
  ): AsyncGenerator<StreamEvent> {
    let eventData = "";
    for await (const line of readLines(body, idleTimeoutMs)) {
      if (line.startsWith("data: ")) {
        eventData = line.slice("data: ".length);
        continue;
      }
      if (line === "" && eventData) {
        let chunk: AnthropicStreamChunk;
        try {
          chunk = JSON.parse(eventData) as AnthropicStreamChunk;
        } catch {
          eventData = "";
          continue;
        }
        if (chunk.type === "content_block_delta") {
          if (chunk.delta?.text) yield { type: "token", content: chunk.delta.text };
        } else if (chunk.type === "message_stop") {
          yield { type: "done" };
          return;
        } else if (chunk.type === "error") {
          yield { type: "error", error: new Error(`anthropic stream error: ${eventData}`) };
          return;
        }
        eventData = "";
      }
    }
    yield { type: "done" };
  }

  private async *readJSONLines(
    body: ReadableStream<Uint8Array>,
    idleTimeoutMs: number,
  ): AsyncGenerator<StreamEvent> {
    for await (const rawLine of readLines(body, idleTimeoutMs)) {
      const line = rawLine.trim();
      if (!line) continue;
      let chunk: OllamaStreamChunk;
      try {
        chunk = JSON.parse(line) as OllamaStreamChunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        yield { type: "error", error: new Error(`ollama error: ${chunk.error}`) };
        return;
      }
      const content = chunk.message?.content;
      if (content) yield { type: "token", content };
      if (chunk.done) {
        yield { type: "done" };
        return;
      }
    }
    yield { type: "done" };
  }
}

interface EmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  error?: { message: string };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
}

interface AnthropicStreamChunk {
  type?: string;
  delta?: { text?: string };
}

interface OllamaStreamChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export function toWireMessages(messages: Message[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const wire: Record<string, unknown> = { role: message.role };
    if (message.content) wire.content = message.content;
    if (message.reasoning_content) wire.reasoning_content = message.reasoning_content;
    if (message.tool_call_id) wire.tool_call_id = message.tool_call_id;
    if (message.name) wire.name = message.name;
    if (message.tool_calls?.length) {
      wire.tool_calls = message.tool_calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    return wire;
  });
}

export function parseChatResponse(data: string, provider: string): ChatResult {
  if (provider === "anthropic") {
    const response = JSON.parse(data) as {
      content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
    };
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of response.content ?? []) {
      if (block.type === "text") textParts.push(block.text ?? "");
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? "",
          name: block.name ?? "",
          arguments: JSON.stringify(block.input ?? {}),
        });
      }
    }
    return { content: textParts.join(""), reasoningContent: "", toolCalls };
  }

  if (provider === "ollama") {
    const response = JSON.parse(data) as {
      content?: string;
      message?: {
        content?: string;
        tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
      };
    };
    const text = response.content || response.message?.content || "";
    const toolCalls = (response.message?.tool_calls ?? []).map((call) => ({
      id: "",
      name: call.function?.name ?? "",
      arguments:
        typeof call.function?.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments ?? {}),
    }));
    return { content: text, reasoningContent: "", toolCalls };
  }

  const response = JSON.parse(data) as {
    choices?: Array<{
      message?: {
        content?: string;
        reasoning_content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const choices = response.choices ?? [];
  if (choices.length === 0) throw new Error("empty chat response");
  const message = choices[0]?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id ?? "",
    name: call.function?.name ?? "",
    arguments: call.function?.arguments ?? "",
  }));
  return {
    content: message.content ?? "",
    reasoningContent: message.reasoning_content ?? "",
    toolCalls,
  };
}

export function convertToAnthropicMessages(messages: Message[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  let pendingToolResults: Array<Record<string, unknown>> = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    result.push({ role: "user", content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.tool_call_id ?? "",
        content: message.content ?? "",
      });
      continue;
    }
    if (message.role === "assistant") {
      flushToolResults();
      if (message.tool_calls && message.tool_calls.length > 0) {
        const blocks: Array<Record<string, unknown>> = [];
        for (const call of message.tool_calls) {
          let input: unknown = {};
          if (call.arguments) {
            try {
              input = JSON.parse(call.arguments);
            } catch {
              input = {};
            }
          }
          if (input === null || input === undefined) input = {};
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input });
        }
        if (message.content) {
          blocks.unshift({ type: "text", text: message.content });
        }
        result.push({ role: "assistant", content: blocks });
      } else {
        result.push({ role: message.role, content: message.content ?? "" });
      }
      continue;
    }
    flushToolResults();
    result.push({ role: message.role, content: message.content ?? "" });
  }
  flushToolResults();
  return result;
}

export function classifyError(statusCode: number, body: string, retryAfterMs = 0): LLMRequestError {
  const detail = truncate(body, 200);
  if (statusCode === 401 || statusCode === 403) {
    return new LLMRequestError(`authentication error (HTTP ${statusCode}): ${detail}`, "fatal", statusCode);
  }
  if (statusCode === 429) {
    return new LLMRequestError(
      `rate limit exceeded (HTTP ${statusCode}): ${detail}`,
      "rate_limit",
      statusCode,
      retryAfterMs,
    );
  }
  if (statusCode === 400) {
    if (
      body.includes("context_length") ||
      body.includes("max_tokens") ||
      body.includes("token limit")
    ) {
      return new LLMRequestError(`context length exceeded (HTTP ${statusCode}): ${detail}`, "fatal", statusCode);
    }
    return new LLMRequestError(`bad request (HTTP ${statusCode}): ${detail}`, "fatal", statusCode);
  }
  if (statusCode >= 500) {
    return new LLMRequestError(`server error (HTTP ${statusCode}): ${detail}`, "transient", statusCode);
  }
  if (statusCode === 408) {
    return new LLMRequestError(`API error (HTTP ${statusCode}): ${detail}`, "transient", statusCode);
  }
  return new LLMRequestError(`API error (HTTP ${statusCode}): ${detail}`, "fatal", statusCode);
}

function requestFailure(error: unknown, signal?: AbortSignal): LLMRequestError {
  if (error instanceof LLMRequestError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  // A deadline or the caller's own abort is not worth another attempt.
  const name = "name" in cause ? cause.name : "";
  const stopped = signal?.aborted || name === "TimeoutError" || name === "AbortError";
  return new LLMRequestError(cause.message, stopped ? "fatal" : "transient");
}

function retryAfterMs(response: Response): number {
  const raw = (response.headers.get("retry-after") ?? "").trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? 0 : Math.max(0, at - Date.now());
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && value >= 0 ? value : fallback;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function idleGuard(timeoutMs: number, onStall: (error: Error) => void): { touch(): void; stop(): void } {
  let timer: NodeJS.Timeout | null = null;
  return {
    touch() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onStall(new Error(`stream idle timeout: no data for ${timeoutMs} ms`)), timeoutMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

async function* readLines(body: ReadableStream<Uint8Array>, idleTimeoutMs: number): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let stall: ((error: Error) => void) | null = null;
  const guard = idleGuard(idleTimeoutMs, (error) => stall?.(error));
  try {
    for (;;) {
      guard.touch();
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            stall = reject;
          }),
        ]));
      } catch (error) {
        // A stalled body never reaches `done` on its own, so release the connection here.
        await reader.cancel().catch(() => undefined);
        const cause = requestFailure(error);
        throw new LLMRequestError(`stream read error: ${cause.message}`, cause.kind);
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        yield line;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, "");
  } finally {
    guard.stop();
    reader.releaseLock();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractModelIds(payload: unknown, provider: string): string[] {
  if (payload === null || typeof payload !== "object") return [];
  const record = payload as { data?: unknown; models?: unknown };
  const rawList =
    provider === "ollama"
      ? Array.isArray(record.models)
        ? record.models
        : Array.isArray(record.data)
          ? record.data
          : []
      : Array.isArray(record.data)
        ? record.data
        : Array.isArray(record.models)
          ? record.models
          : [];
  const ids: string[] = [];
  for (const item of rawList) {
    let rawId: unknown;
    if (typeof item === "string") {
      rawId = item;
    } else if (item !== null && typeof item === "object") {
      const obj = item as { id?: unknown; name?: unknown; model?: unknown };
      rawId = provider === "ollama" ? (obj.name ?? obj.model ?? obj.id) : obj.id;
    }
    if (typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= 500) break;
  }
  return ids;
}
