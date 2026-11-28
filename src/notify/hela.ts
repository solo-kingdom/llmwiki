import { logger } from "../logger.js";
import type { Store } from "../store/interfaces.js";
import {
  CONFIG_HELA_NOTIFY_API_KEY,
  CONFIG_HELA_NOTIFY_BASE_URL,
  CONFIG_HELA_NOTIFY_ENABLED,
  CONFIG_HELA_NOTIFY_EVENTS,
  DEFAULT_HELA_NOTIFY_EVENTS,
} from "../store/types.js";

export type HelaNotifyEventType = "ingest_failed" | "review_required" | "server_error";

export const ALL_HELA_NOTIFY_EVENTS: readonly HelaNotifyEventType[] = [
  "ingest_failed",
  "review_required",
  "server_error",
];

const VALID_EVENT_SET = new Set<string>(ALL_HELA_NOTIFY_EVENTS);
const DEDUPE_WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 500;
const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 2_000;

export interface HelaNotifyOverrides {
  enabled?: boolean | string;
  baseUrl?: string;
  apiKey?: string;
  events?: string;
}

export interface ResolvedHelaConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  events: HelaNotifyEventType[];
  source: "settings" | "env" | "none";
}

export interface HelaNotifyEvent {
  type: HelaNotifyEventType;
  title: string;
  content: string;
  dedupeKey?: string;
}

export interface HelaNotifyTestResult {
  ok: boolean;
  status?: number;
  message_id?: string;
  target: string;
  message: string;
}

export interface HelaFetchOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  retryDelayMs?: number;
}

const dedupeTimestamps = new Map<string, number>();

export function resetHelaNotifyDedupeForTests(): void {
  dedupeTimestamps.clear();
}

export function normalizeHelaBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("hela_notify_base_url must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("hela_notify_base_url must use http:// or https://");
  }
  return trimmed;
}

export function parseHelaNotifyEvents(raw: string): HelaNotifyEventType[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [...ALL_HELA_NOTIFY_EVENTS];
  }
  if (trimmed.toLowerCase() === "none") {
    return [];
  }
  const seen = new Set<HelaNotifyEventType>();
  const result: HelaNotifyEventType[] = [];
  for (const part of trimmed.split(",")) {
    const token = part.trim().toLowerCase();
    if (!token) continue;
    if (!VALID_EVENT_SET.has(token)) {
      throw new Error(`unsupported hela_notify_events item: "${token}"`);
    }
    const typed = token as HelaNotifyEventType;
    if (!seen.has(typed)) {
      seen.add(typed);
      result.push(typed);
    }
  }
  return result;
}

export function formatHelaNotifyEvents(events: HelaNotifyEventType[]): string {
  if (events.length === 0) return "none";
  return events.join(",");
}

async function safeGetConfig(db: Store | null | undefined, key: string): Promise<string> {
  if (!db || typeof db.getConfig !== "function") return "";
  try {
    return (await db.getConfig(key)) ?? "";
  } catch {
    return "";
  }
}

function parseBoolString(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

export async function resolveHelaConfig(
  db: Store | null | undefined,
  overrides: HelaNotifyOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedHelaConfig> {
  const [dbEnabledRaw, dbBaseRaw, dbKeyRaw, dbEventsRaw] = await Promise.all([
    safeGetConfig(db, CONFIG_HELA_NOTIFY_ENABLED),
    safeGetConfig(db, CONFIG_HELA_NOTIFY_BASE_URL),
    safeGetConfig(db, CONFIG_HELA_NOTIFY_API_KEY),
    safeGetConfig(db, CONFIG_HELA_NOTIFY_EVENTS),
  ]);

  const envBaseRaw = (env.LLMWIKI_HELA_API_BASE ?? "").trim();
  const envKeyRaw = (env.LLMWIKI_HELA_API_KEY ?? "").trim();
  const envEnabledRaw = (env.LLMWIKI_HELA_NOTIFY_ENABLED ?? "").trim();

  const rawBase =
    overrides.baseUrl !== undefined
      ? overrides.baseUrl
      : dbBaseRaw.trim() || envBaseRaw;
  let baseUrl = "";
  if (rawBase.trim()) {
    try {
      baseUrl = normalizeHelaBaseUrl(rawBase);
    } catch {
      baseUrl = "";
    }
  }

  const apiKey =
    overrides.apiKey !== undefined && overrides.apiKey.trim()
      ? overrides.apiKey.trim()
      : dbKeyRaw.trim() || envKeyRaw;

  let source: "settings" | "env" | "none" = "none";
  if (dbBaseRaw.trim() || dbKeyRaw.trim() || dbEnabledRaw.trim()) {
    source = "settings";
  } else if (envBaseRaw || envKeyRaw || envEnabledRaw) {
    source = "env";
  }

  let enabled = false;
  if (overrides.enabled !== undefined) {
    enabled =
      typeof overrides.enabled === "boolean"
        ? overrides.enabled
        : (parseBoolString(overrides.enabled) ?? false);
  } else {
    const dbEnabled = parseBoolString(dbEnabledRaw);
    if (dbEnabled !== null) {
      enabled = dbEnabled;
    } else {
      const envEnabled = parseBoolString(envEnabledRaw);
      if (envEnabled === false) {
        enabled = false;
      } else if (envEnabled === true || (Boolean(envBaseRaw) && Boolean(envKeyRaw))) {
        enabled = true;
      }
    }
  }

  let events: HelaNotifyEventType[] = [...ALL_HELA_NOTIFY_EVENTS];
  const rawEvents = overrides.events !== undefined ? overrides.events : dbEventsRaw || DEFAULT_HELA_NOTIFY_EVENTS;
  try {
    events = parseHelaNotifyEvents(rawEvents);
  } catch {
    events = [...ALL_HELA_NOTIFY_EVENTS];
  }

  return { enabled, baseUrl, apiKey, events, source };
}

function truncateChars(value: string, max: number): string {
  const chars = [...value.trim()];
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max - 1).join("")}…`;
}

function isDeduplicated(key: string | undefined, nowMs: number): boolean {
  if (!key) return false;
  const last = dedupeTimestamps.get(key);
  if (last !== undefined && nowMs - last < DEDUPE_WINDOW_MS) {
    return true;
  }
  dedupeTimestamps.set(key, nowMs);
  if (dedupeTimestamps.size > 500) {
    for (const [k, ts] of dedupeTimestamps) {
      if (nowMs - ts >= DEDUPE_WINDOW_MS) dedupeTimestamps.delete(k);
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PostHelaResult {
  ok: boolean;
  status?: number;
  messageId?: string;
  error?: string;
}

async function postHelaMessage(
  baseUrl: string,
  apiKey: string,
  title: string,
  content: string,
  options: HelaFetchOptions = {},
): Promise<PostHelaResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelay = options.retryDelayMs ?? RETRY_DELAY_MS;
  const endpoint = `${baseUrl}/api/v1/messages`;
  const payload = JSON.stringify({
    title: truncateChars(title, MAX_TITLE_CHARS),
    content: truncateChars(content, MAX_CONTENT_CHARS),
    format: "markdown",
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        let messageId = "";
        try {
          const data = (await response.json()) as { id?: unknown };
          if (typeof data?.id === "string") messageId = data.id;
        } catch {
          // ignore non-JSON body
        }
        return { ok: true, status: response.status, ...(messageId ? { messageId } : {}) };
      }

      const bodyText = await response.text().catch(() => "");
      const shouldRetry = attempt === 0 && (response.status === 429 || response.status >= 500);
      if (shouldRetry) {
        await sleep(retryDelay);
        continue;
      }
      return {
        ok: false,
        status: response.status,
        error: bodyText ? `HTTP ${response.status}: ${bodyText}` : `HTTP ${response.status}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt === 0) {
        await sleep(retryDelay);
        continue;
      }
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: "unexpected retry exhaustion" };
}

export async function notifyHelaEvent(
  db: Store | null | undefined,
  event: HelaNotifyEvent,
  options: HelaFetchOptions = {},
): Promise<boolean> {
  try {
    const cfg = await resolveHelaConfig(db, {}, options.env);
    if (!cfg.enabled || !cfg.baseUrl || !cfg.apiKey) return false;
    if (!cfg.events.includes(event.type)) return false;

    const nowMs = (options.now ?? Date.now)();
    if (isDeduplicated(event.dedupeKey, nowMs)) return false;

    const result = await postHelaMessage(cfg.baseUrl, cfg.apiKey, event.title, event.content, options);
    if (!result.ok) {
      logger.warn(
        { eventType: event.type, status: result.status, error: result.error },
        "hela notify failed",
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.warn({ error, eventType: event.type }, "hela notify threw unexpectedly");
    return false;
  }
}

export function notifyHelaEventAsync(
  db: Store | null | undefined,
  event: HelaNotifyEvent,
  options: HelaFetchOptions = {},
): void {
  void notifyHelaEvent(db, event, options);
}

export async function sendHelaTestNotification(
  db: Store | null | undefined,
  overrides: HelaNotifyOverrides = {},
  options: HelaFetchOptions = {},
): Promise<HelaNotifyTestResult> {
  const cfg = await resolveHelaConfig(db, overrides, options.env);
  if (!cfg.baseUrl) {
    return {
      ok: false,
      target: "",
      message: "请先配置合法的 Hela API Base URL（http:// 或 https://）",
    };
  }
  if (!cfg.apiKey) {
    return {
      ok: false,
      target: cfg.baseUrl,
      message: "请先配置 Hela API Key",
    };
  }

  const result = await postHelaMessage(
    cfg.baseUrl,
    cfg.apiKey,
    "[llmwiki] 通知连通性测试",
    `来自 **llmwiki** 的测试通知（来源：${cfg.source}，时间：${new Date().toISOString()}）。`,
    options,
  );
  if (!result.ok) {
    return {
      ok: false,
      ...(result.status !== undefined ? { status: result.status } : {}),
      target: cfg.baseUrl,
      message: result.error || "发送失败",
    };
  }
  return {
    ok: true,
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.messageId ? { message_id: result.messageId } : {}),
    target: cfg.baseUrl,
    message: result.messageId ? `测试通知已发送（id=${result.messageId}）` : "测试通知已发送",
  };
}
