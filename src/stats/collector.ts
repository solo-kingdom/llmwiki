import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes, routePath } from "hono/route";
import { logger } from "../logger.js";
import { getAuthContext } from "../server/auth.js";
import type { ApiAccessStatsStore } from "../store/interfaces.js";
import type { ApiAccessLogInput, ApiAuthOutcome, ApiAuthType } from "../store/types.js";

const DEFAULT_MAX_QUEUE_SIZE = 2048;
const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_FLUSH_INTERVAL_MS = 1500;
const DEFAULT_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DROP_WARN_THROTTLE_MS = 30_000;

const STATIC_EXTENSIONS = new Set([
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".map",
]);

const HEALTH_PATHS = new Set(["/health", "/healthz", "/readyz", "/livez", "/api/v1/health"]);
const WILDCARD_ROUTES = new Set(["", "*", "/*", "/api/*"]);

export function isApiStatsEnabled(envValue = process.env.API_STATS_ENABLED): boolean {
  if (envValue === undefined) return true;
  const normalized = envValue.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}

export function resolveRetentionDays(envValue = process.env.API_STATS_RETENTION_DAYS): number {
  if (!envValue) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(envValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

export function isStatsSelfPath(reqPath: string): boolean {
  return reqPath.includes("/api-stats") || reqPath.startsWith("/stats/api");
}

export function shouldSkipStatsPath(reqPath: string): boolean {
  if (HEALTH_PATHS.has(reqPath)) return true;
  if (reqPath.startsWith("/_next/static/") || reqPath.startsWith("/assets/")) return true;
  const dotIdx = reqPath.lastIndexOf(".");
  if (dotIdx > reqPath.lastIndexOf("/")) {
    const ext = reqPath.slice(dotIdx).toLowerCase();
    if (STATIC_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

export function resolveRouteTemplate(c: Context): string {
  const routes = matchedRoutes(c);
  for (let i = routes.length - 1; i >= 0; i -= 1) {
    const p = routes[i]?.path ?? "";
    if (!WILDCARD_ROUTES.has(p)) {
      return p;
    }
  }
  const rp = routePath(c);
  if (rp && !WILDCARD_ROUTES.has(rp)) {
    return rp;
  }
  return "/_unmatched";
}

export function sanitizeControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, "").trim();
}

export function sanitizeClientIp(c: Context): string | null {
  const xff = c.req.header("x-forwarded-for");
  const raw = xff ? xff.split(",")[0] ?? "" : c.req.header("x-real-ip") ?? "";
  const cleaned = sanitizeControlChars(raw).slice(0, 64);
  return cleaned || null;
}

export function sanitizeUserAgent(c: Context): string | null {
  const raw = c.req.header("user-agent") ?? "";
  const cleaned = sanitizeControlChars(raw).slice(0, 200);
  return cleaned || null;
}

export function redactSensitiveText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = sanitizeControlChars(raw);
  if (!cleaned) return null;
  cleaned = cleaned
    .replace(/llmwiki_sk_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(token|key|secret|password|authorization)=([^&\s]+)/gi, "$1=[REDACTED]");
  return cleaned.slice(0, 120) || null;
}

export function deriveAuthOutcome(statusCode: number): ApiAuthOutcome {
  if (statusCode === 401) return "unauthorized_401";
  if (statusCode === 403) return "forbidden_403";
  if (statusCode === 429) return "rate_limited_429";
  if (statusCode >= 500) return "error_5xx";
  return "ok";
}

export interface ApiStatsCollectorOptions {
  enabled?: boolean;
  maxQueueSize?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  retentionDays?: number;
  syncWrite?: boolean;
}

export class ApiStatsCollector {
  readonly enabled: boolean;
  readonly maxQueueSize: number;
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  readonly retentionDays: number;
  readonly syncWrite: boolean;

  private readonly store: Partial<ApiAccessStatsStore>;
  private readonly queue: ApiAccessLogInput[] = [];
  private droppedCount = 0;
  private lastDropWarnAt = 0;
  private flushing: Promise<void> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(store: Partial<ApiAccessStatsStore>, options: ApiStatsCollectorOptions = {}) {
    this.store = store;
    this.enabled = options.enabled ?? isApiStatsEnabled();
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.retentionDays = options.retentionDays ?? resolveRetentionDays();
    this.syncWrite = options.syncWrite ?? false;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  enqueue(entry: ApiAccessLogInput): boolean {
    if (!this.enabled) return false;
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedCount += 1;
      const now = Date.now();
      if (now - this.lastDropWarnAt >= DROP_WARN_THROTTLE_MS) {
        this.lastDropWarnAt = now;
        logger.warn({ droppedCount: this.droppedCount }, "api_access_logs queue full, dropping events");
      }
      return false;
    }
    this.queue.push(entry);
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
    return true;
  }

  async recordSync(entry: ApiAccessLogInput): Promise<void> {
    if (!this.enabled) return;
    if (typeof this.store.insertApiAccessLogs !== "function") return;
    try {
      await this.store.insertApiAccessLogs([entry]);
    } catch (error) {
      logger.warn({ error }, "api_access_logs sync write failed");
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0) return;
    if (typeof this.store.insertApiAccessLogs !== "function") {
      this.queue.length = 0;
      return;
    }

    this.flushing = (async () => {
      try {
        while (this.queue.length > 0) {
          const batch = this.queue.splice(0, this.batchSize);
          await this.store.insertApiAccessLogs!(batch);
        }
      } catch (error) {
        logger.warn({ error }, "api_access_logs batch flush failed");
      } finally {
        this.flushing = null;
      }
    })();

    return this.flushing;
  }

  async purgeExpired(nowMs = Date.now()): Promise<number> {
    if (typeof this.store.purgeExpiredApiAccessLogs !== "function") return 0;
    const cutoff = new Date(nowMs - this.retentionDays * 86_400_000).toISOString();
    let total = 0;
    try {
      while (true) {
        const deleted = await this.store.purgeExpiredApiAccessLogs(cutoff, 5000);
        total += deleted;
        if (deleted < 5000) break;
      }
    } catch (error) {
      logger.warn({ error }, "api_access_logs TTL purge failed");
    }
    return total;
  }

  start(startCleanup = true): void {
    if (!this.enabled) return;
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      this.flushTimer.unref?.();
    }
    if (startCleanup && !this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => {
        void this.purgeExpired();
      }, CLEANUP_INTERVAL_MS);
      this.cleanupTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.flush();
  }
}

async function extractErrorCode(c: Context, statusCode: number): Promise<string | null> {
  if (statusCode < 400) return null;
  const headerCode = c.res.headers.get("x-error-code");
  if (headerCode) return redactSensitiveText(headerCode);
  const contentType = c.res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await c.res.clone().json()) as { code?: unknown; error?: unknown };
      const raw = typeof body?.code === "string" ? body.code : typeof body?.error === "string" ? body.error : "";
      if (raw) return redactSensitiveText(raw);
    } catch {
      // ignore non-json or unreadable body
    }
  }
  return `http_${statusCode}`;
}

export function apiStatsMiddleware(collector: ApiStatsCollector): MiddlewareHandler {
  return async (c, next) => {
    if (!collector.enabled || shouldSkipStatsPath(c.req.path)) {
      await next();
      return;
    }

    const startMs = performance.now();
    await next();
    const durationMs = Math.max(0, Math.round(performance.now() - startMs));
    const statusCode = c.res.status;
    if (isStatsSelfPath(c.req.path) && statusCode < 400) {
      return;
    }
    const auth = getAuthContext(c);
    const authType: ApiAuthType =
      auth.authType ?? (auth.kind === "api_key" ? "api_key" : auth.kind === "legacy_token" ? "session" : "anonymous");

    const entry: ApiAccessLogInput = {
      occurred_at: new Date().toISOString(),
      method: c.req.method.toUpperCase(),
      route_template: resolveRouteTemplate(c),
      status_code: statusCode,
      duration_ms: durationMs,
      auth_type: authType,
      user_id: null,
      api_key_id: auth.keyId ?? null,
      api_key_prefix: auth.keyPrefix ?? null,
      api_key_name: auth.keyName ?? null,
      auth_outcome: deriveAuthOutcome(statusCode),
      client_ip: sanitizeClientIp(c),
      user_agent: sanitizeUserAgent(c),
      error_code: await extractErrorCode(c, statusCode),
    };

    if (collector.syncWrite) {
      await collector.recordSync(entry);
    } else {
      collector.enqueue(entry);
    }
  };
}
