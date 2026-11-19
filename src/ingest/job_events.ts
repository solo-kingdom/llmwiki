import type { Message } from "../llm/types.js";
import type { Store } from "../store/interfaces.js";
import { DEFAULT_JOB_EVENTS_MAX_COUNT } from "../store/types.js";
import type { JobRecorder } from "./types.js";

const MAX_PAYLOAD_PREVIEW_BYTES = 32 * 1024;
const SECRET_KEYS = new Set(["api_key", "authorization", "x-api-key"]);

export class StoreJobRecorder implements JobRecorder {
  constructor(
    private readonly db: Store | null,
    private readonly jobId: string,
    private readonly maxCount: number = DEFAULT_JOB_EVENTS_MAX_COUNT,
  ) {}

  record(step: string, phase: string, message: string, payload: Record<string, unknown> | null): void {
    if (!this.db || !this.jobId) return;
    const safe = sanitizePayload(payload);
    void this.db
      .insertIngestJobEvent(this.jobId, step, phase, message, safe ?? {}, this.maxCount)
      .catch(() => undefined);
  }
}

export async function createJobRecorder(db: Store | null, jobId: string): Promise<StoreJobRecorder> {
  let maxCount = DEFAULT_JOB_EVENTS_MAX_COUNT;
  if (db) {
    try {
      maxCount = await db.getJobEventsMaxCount();
    } catch {
      maxCount = DEFAULT_JOB_EVENTS_MAX_COUNT;
    }
  }
  return new StoreJobRecorder(db, jobId, maxCount);
}

export function sanitizePayload(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!payload) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    out[key] = sanitizeValue(value);
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return truncatePreview(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") return sanitizePayload(value as Record<string, unknown>);
  return value;
}

export function truncatePreview(value: string): string {
  if (Buffer.byteLength(value) <= MAX_PAYLOAD_PREVIEW_BYTES) return value;
  const buffer = Buffer.from(value);
  return `${buffer.subarray(0, MAX_PAYLOAD_PREVIEW_BYTES).toString("utf8")}…(truncated)`;
}

export function recordLLMRequest(
  recorder: JobRecorder | null,
  step: string,
  model: string,
  messages: Array<{ role: string; content?: string }>,
  temperature: number,
  maxTokens: number,
): void {
  recorder?.record(step, "request", `${step} LLM request`, {
    model,
    messages: messages.map((message) => ({ role: message.role, content: message.content ?? "" })),
    temperature,
    max_tokens: maxTokens,
  });
}

export function recordLLMResponse(
  recorder: JobRecorder | null,
  step: string,
  content: string,
  durationMs: number,
): void {
  recorder?.record(step, "response", `${step} LLM response`, {
    content_preview: truncatePreview(content),
    duration_ms: durationMs,
    char_count: [...content].length,
  });
}

export function llmMessagesForRecord(messages: Message[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({ role: message.role, content: message.content ?? "" }));
}
