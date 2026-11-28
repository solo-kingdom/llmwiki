import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { ApiStatsCollector, redactSensitiveText, sanitizeControlChars } from "../stats/collector.js";
import type { ApiAccessStatsStore, Store } from "../store/interfaces.js";
import {
  API_KEY_PREFIX,
  type ApiAccessLogInput,
  type ApiAccessLogRecord,
  type ApiKeyRecord,
  type ApiStatsApiKeyDetailResponse,
  type ApiStatsApiKeysResponse,
  type ApiStatsErrorsResponse,
  type ApiStatsFilter,
  type ApiStatsOverviewResponse,
  type ApiStatsRouteItem,
  type ApiStatsRouteSort,
  type ApiStatsRoutesResponse,
  type ApiStatsSeriesPoint,
  type ApiStatsStatusClass,
} from "../store/types.js";
import { hashApiKey } from "./api_keys.js";

interface StoredKey extends ApiKeyRecord {
  key_hash: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function percentileCont(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function matchesFilter(row: ApiAccessLogRecord, filter: ApiStatsFilter): boolean {
  const ts = Date.parse(row.occurred_at);
  if (ts < Date.parse(filter.from) || ts > Date.parse(filter.to)) return false;
  if (filter.method && row.method !== filter.method.toUpperCase()) return false;
  if (filter.route && row.route_template !== filter.route) return false;
  if (filter.status_class) {
    const s = row.status_code;
    if (filter.status_class === "2xx" && (s < 200 || s >= 300)) return false;
    if (filter.status_class === "3xx" && (s < 300 || s >= 400)) return false;
    if (filter.status_class === "4xx" && (s < 400 || s >= 500)) return false;
    if (filter.status_class === "5xx" && (s < 500 || s >= 600)) return false;
  }
  if (filter.auth_type && row.auth_type !== filter.auth_type) return false;
  if (filter.api_key_id) {
    if (filter.api_key_id === "__invalid__") {
      if (row.auth_type !== "invalid_key") return false;
    } else if (row.api_key_id !== filter.api_key_id) {
      return false;
    }
  }
  return true;
}

function bucketIso(iso: string, unit: "minute" | "hour" | "day"): string {
  const d = new Date(iso);
  if (unit === "minute") {
    d.setUTCSeconds(0, 0);
  } else if (unit === "hour") {
    d.setUTCMinutes(0, 0, 0);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

function buildSeries(rows: ApiAccessLogRecord[], unit: "minute" | "hour" | "day"): ApiStatsSeriesPoint[] {
  const map = new Map<string, ApiAccessLogRecord[]>();
  for (const r of rows) {
    const b = bucketIso(r.occurred_at, unit);
    const arr = map.get(b) ?? [];
    arr.push(r);
    map.set(b, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket_start, items]) => {
      const durations = items.map((i) => i.duration_ms).sort((a, b) => a - b);
      return {
        bucket_start,
        requests: items.length,
        error_4xx: items.filter((i) => i.status_code >= 400 && i.status_code < 500).length,
        error_5xx: items.filter((i) => i.status_code >= 500).length,
        p95_ms: round2(percentileCont(durations, 0.95)),
      };
    });
}

function buildRouteItems(rows: ApiAccessLogRecord[]): ApiStatsRouteItem[] {
  const map = new Map<string, ApiAccessLogRecord[]>();
  for (const r of rows) {
    const key = `${r.method} ${r.route_template}`;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return [...map.values()].map((items) => {
    const first = items[0]!;
    const durations = items.map((i) => i.duration_ms).sort((a, b) => a - b);
    const err4 = items.filter((i) => i.status_code >= 400 && i.status_code < 500).length;
    const err5 = items.filter((i) => i.status_code >= 500).length;
    const avg = items.reduce((s, i) => s + i.duration_ms, 0) / items.length;
    return {
      method: first.method,
      route_template: first.route_template,
      count: items.length,
      error_4xx: err4,
      error_5xx: err5,
      error_rate: round2(((err4 + err5) / items.length) * 100),
      avg_ms: round2(avg),
      p95_ms: round2(percentileCont(durations, 0.95)),
      p99_ms: round2(percentileCont(durations, 0.99)),
    };
  });
}

function makeInMemoryStore(initialKeys: StoredKey[] = []) {
  const keys = new Map<string, StoredKey>();
  for (const item of initialKeys) keys.set(item.id, { ...item });
  const config = new Map<string, string>();
  const logs: ApiAccessLogRecord[] = [];
  let nextId = 1;

  const statsStore: ApiAccessStatsStore = {
    insertApiAccessLogs: vi.fn(async (entries: ApiAccessLogInput[]) => {
      for (const e of entries) {
        logs.push({
          id: nextId++,
          occurred_at: e.occurred_at,
          method: e.method,
          route_template: e.route_template,
          status_code: e.status_code,
          duration_ms: e.duration_ms,
          auth_type: e.auth_type,
          user_id: e.user_id ?? null,
          api_key_id: e.api_key_id ?? null,
          api_key_prefix: e.api_key_prefix ?? null,
          api_key_name: e.api_key_name ?? null,
          auth_outcome: e.auth_outcome,
          client_ip: e.client_ip ?? null,
          user_agent: e.user_agent ?? null,
          error_code: e.error_code ?? null,
        });
      }
    }),

    purgeExpiredApiAccessLogs: vi.fn(async (beforeIso: string, batchSize = 5000) => {
      const cutoff = Date.parse(beforeIso);
      let deleted = 0;
      for (let i = logs.length - 1; i >= 0 && deleted < batchSize; i -= 1) {
        if (Date.parse(logs[i]!.occurred_at) < cutoff) {
          logs.splice(i, 1);
          deleted += 1;
        }
      }
      return deleted;
    }),

    getApiStatsOverview: vi.fn(async (filter: ApiStatsFilter): Promise<ApiStatsOverviewResponse> => {
      const matched = logs.filter((r) => matchesFilter(r, filter));
      const total = matched.length;
      const ok = matched.filter((r) => r.status_code < 400).length;
      const err4 = matched.filter((r) => r.status_code >= 400 && r.status_code < 500).length;
      const err5 = matched.filter((r) => r.status_code >= 500).length;
      const durations = matched.map((r) => r.duration_ms).sort((a, b) => a - b);
      const avg = total > 0 ? matched.reduce((s, r) => s + r.duration_ms, 0) / total : 0;
      const windowSec = Math.max(1, (Date.parse(filter.to) - Date.parse(filter.from)) / 1000 || 86400);
      const bucket = filter.range === "1h" ? "minute" : filter.range === "7d" || filter.range === "30d" ? "day" : "hour";

      const statusMap = new Map<ApiStatsStatusClass, number>();
      const authMap = new Map<string, number>();
      for (const r of matched) {
        const sc: ApiStatsStatusClass =
          r.status_code < 300 ? "2xx" : r.status_code < 400 ? "3xx" : r.status_code < 500 ? "4xx" : "5xx";
        statusMap.set(sc, (statusMap.get(sc) ?? 0) + 1);
        authMap.set(r.auth_type, (authMap.get(r.auth_type) ?? 0) + 1);
      }

      return {
        capabilities: { has_api_keys: true, scope: "global" },
        range: { key: filter.range ?? "24h", from: filter.from, to: filter.to, bucket },
        summary: {
          total_requests: total,
          rps: round2(total / windowSec),
          success_rate: total > 0 ? round2((ok / total) * 100) : 0,
          error_4xx_rate: total > 0 ? round2((err4 / total) * 100) : 0,
          error_5xx_rate: total > 0 ? round2((err5 / total) * 100) : 0,
          avg_duration_ms: round2(avg),
          p50_ms: round2(percentileCont(durations, 0.5)),
          p95_ms: round2(percentileCont(durations, 0.95)),
          p99_ms: round2(percentileCont(durations, 0.99)),
          active_routes: new Set(matched.map((r) => r.route_template)).size,
        },
        series: buildSeries(matched, bucket),
        status_distribution: [...statusMap.entries()].map(([status_class, count]) => ({ status_class, count })),
        auth_sources: [...authMap.entries()].map(([auth_type, count]) => ({
          auth_type: auth_type as ApiStatsOverviewResponse["auth_sources"][number]["auth_type"],
          count,
        })),
      };
    }),

    getApiStatsRoutes: vi.fn(
      async (filter: ApiStatsFilter, options?: { sort?: ApiStatsRouteSort; limit?: number }): Promise<ApiStatsRoutesResponse> => {
        const matched = logs.filter((r) => matchesFilter(r, filter));
        const items = buildRouteItems(matched);
        const sort = options?.sort ?? "count";
        items.sort((a, b) => {
          if (sort === "error_rate") return b.error_rate - a.error_rate || b.count - a.count;
          if (sort === "p95") return b.p95_ms - a.p95_ms || b.count - a.count;
          return b.count - a.count;
        });
        return { items: items.slice(0, options?.limit ?? 50) };
      },
    ),

    getApiStatsErrors: vi.fn(async (filter: ApiStatsFilter, limit = 50): Promise<ApiStatsErrorsResponse> => {
      const matched = logs
        .filter((r) => matchesFilter(r, filter) && r.status_code >= 400)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id);
      return { items: matched.slice(0, limit) };
    }),

    getApiStatsApiKeys: vi.fn(async (filter: ApiStatsFilter): Promise<ApiStatsApiKeysResponse> => {
      const matched = logs.filter((r) => matchesFilter(r, filter));
      const unauthorized401 = matched.filter((r) => r.auth_type === "invalid_key" && r.status_code === 401).length;
      const forbidden403 = matched.filter((r) => r.auth_type === "api_key" && r.status_code === 403).length;

      const byKey = new Map<string, ApiAccessLogRecord[]>();
      for (const r of matched) {
        if (!r.api_key_id) continue;
        const arr = byKey.get(r.api_key_id) ?? [];
        arr.push(r);
        byKey.set(r.api_key_id, arr);
      }
      const totalKeyRequests = [...byKey.values()].reduce((s, arr) => s + arr.length, 0);
      const items: ApiStatsApiKeysResponse["items"] = [];
      for (const [id, arr] of byKey.entries()) {
        const active = keys.get(id);
        const durations = arr.map((r) => r.duration_ms).sort((a, b) => a - b);
        const last = arr.map((r) => r.occurred_at).sort().at(-1) ?? null;
        items.push({
          api_key_id: id,
          api_key_prefix: active?.prefix ?? arr[0]?.api_key_prefix ?? "",
          api_key_name: active?.name ?? arr[0]?.api_key_name ?? "",
          user_id: null,
          status: active ? "active" : "revoked",
          count: arr.length,
          share_pct: totalKeyRequests > 0 ? round2((arr.length / totalKeyRequests) * 100) : 0,
          error_4xx: arr.filter((r) => r.status_code >= 400 && r.status_code < 500).length,
          error_5xx: arr.filter((r) => r.status_code >= 500).length,
          p95_ms: round2(percentileCont(durations, 0.95)),
          last_seen_at: last,
        });
      }
      for (const active of keys.values()) {
        if (!byKey.has(active.id)) {
          items.push({
            api_key_id: active.id,
            api_key_prefix: active.prefix,
            api_key_name: active.name,
            user_id: null,
            status: "active",
            count: 0,
            share_pct: 0,
            error_4xx: 0,
            error_5xx: 0,
            p95_ms: 0,
            last_seen_at: null,
          });
        }
      }
      items.sort((a, b) => b.count - a.count);
      return {
        summary: {
          total_key_requests: totalKeyRequests,
          active_key_count: keys.size,
          unauthorized_401_count: unauthorized401,
          forbidden_403_count: forbidden403,
        },
        items,
      };
    }),

    getApiStatsApiKeyDetail: vi.fn(
      async (keyId: string, filter: ApiStatsFilter): Promise<ApiStatsApiKeyDetailResponse | null> => {
        const isInvalid = keyId === "__invalid__";
        const scoped: ApiStatsFilter = isInvalid
          ? { ...filter, auth_type: "invalid_key", api_key_id: undefined }
          : { ...filter, api_key_id: keyId };
        const matched = logs.filter((r) => matchesFilter(r, scoped));
        const active = isInvalid ? undefined : keys.get(keyId);
        if (!isInvalid && !active && matched.length === 0) return null;

        const bucket = filter.range === "1h" ? "minute" : filter.range === "7d" || filter.range === "30d" ? "day" : "hour";
        const durations = matched.map((r) => r.duration_ms).sort((a, b) => a - b);
        const errRows = matched.filter((r) => r.status_code >= 400);
        return {
          key: {
            api_key_id: keyId,
            api_key_prefix: isInvalid ? "invalid" : active?.prefix ?? matched[0]?.api_key_prefix ?? "",
            api_key_name: isInvalid ? "无效 / 已吊销 Key 尝试" : active?.name ?? matched[0]?.api_key_name ?? "",
            status: isInvalid ? "invalid" : active ? "active" : "revoked",
            total_requests: matched.length,
            error_4xx: matched.filter((r) => r.status_code >= 400 && r.status_code < 500).length,
            error_5xx: matched.filter((r) => r.status_code >= 500).length,
            p95_ms: round2(percentileCont(durations, 0.95)),
            last_seen_at: matched.map((r) => r.occurred_at).sort().at(-1) ?? null,
          },
          series: buildSeries(matched, bucket),
          top_routes: buildRouteItems(matched).sort((a, b) => b.count - a.count).slice(0, 20),
          error_routes: buildRouteItems(errRows).sort((a, b) => b.count - a.count).slice(0, 20),
          recent_errors: errRows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 50),
        };
      },
    ),
  };

  const store = {
    getConfig: vi.fn(async (key: string) => config.get(key) ?? ""),
    setConfig: vi.fn(async (key: string, value: string) => {
      config.set(key, value);
    }),
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    getDocument: vi.fn().mockResolvedValue(null),
    listDocumentsFiltered: vi.fn().mockResolvedValue([]),
    listDocuments: vi.fn().mockResolvedValue([]),
    listFolders: vi.fn().mockResolvedValue([]),
    getWorkspace: vi.fn().mockResolvedValue(null),

    createApiKey: vi.fn(async (input: { id: string; name: string; key_hash: string; prefix: string }) => {
      const record: StoredKey = {
        id: input.id,
        name: input.name,
        prefix: input.prefix,
        key_hash: input.key_hash,
        created_at: "2026-11-28 10:00:00",
        last_used_at: null,
      };
      keys.set(record.id, record);
      return {
        id: record.id,
        name: record.name,
        prefix: record.prefix,
        created_at: record.created_at,
        last_used_at: record.last_used_at,
      };
    }),
    listApiKeys: vi.fn(async () => [...keys.values()]),
    countApiKeys: vi.fn(async () => keys.size),
    findApiKeyByHash: vi.fn(async (keyHash: string) => {
      for (const item of keys.values()) {
        if (item.key_hash === keyHash) {
          return {
            id: item.id,
            name: item.name,
            prefix: item.prefix,
            created_at: item.created_at,
            last_used_at: item.last_used_at,
          };
        }
      }
      return null;
    }),
    touchApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn(async (id: string) => keys.delete(id)),
    ...statsStore,
  } as unknown as Store;

  return { store, keys, logs };
}

function makeApp(store: Store, collector: ApiStatsCollector, token = "") {
  return createApp({
    db: store,
    token,
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
    statsCollector: collector,
  });
}

describe("API access stats collector, boundaries & 5 endpoints", () => {
  it("drops events without blocking when bounded queue (2048) is full and supports API_STATS_ENABLED=false", async () => {
    const { store, logs } = makeInMemoryStore();
    const collector = new ApiStatsCollector(store, { enabled: true, maxQueueSize: 2048, batchSize: 100_000 });

    const sample: ApiAccessLogInput = {
      occurred_at: new Date().toISOString(),
      method: "GET",
      route_template: "/api/v1/settings",
      status_code: 200,
      duration_ms: 5,
      auth_type: "session",
      auth_outcome: "ok",
    };

    for (let i = 0; i < 2048; i += 1) {
      expect(collector.enqueue(sample)).toBe(true);
    }
    expect(collector.getQueueLength()).toBe(2048);
    expect(collector.enqueue(sample)).toBe(false);
    expect(collector.enqueue(sample)).toBe(false);
    expect(collector.getDroppedCount()).toBe(2);

    await collector.flush();
    expect(logs).toHaveLength(2048);
    expect(collector.getQueueLength()).toBe(0);

    const disabled = new ApiStatsCollector(store, { enabled: false });
    expect(disabled.enqueue(sample)).toBe(false);
    await disabled.recordSync(sample);
    expect(logs).toHaveLength(2048);
  });

  it("normalizes Hono route templates, folds unmatched 404 to /_unmatched, and skips health/static/api-stats", async () => {
    const { store, logs } = makeInMemoryStore();
    const collector = new ApiStatsCollector(store, { enabled: true, syncWrite: true });
    const app = makeApp(store, collector);

    await app.request("/api/v1/documents/doc-123");
    await app.request("/api/v1/documents/doc-456");
    await app.request("/api/v1/does-not-exist/abc");
    await app.request("/random-scan/.env");

    // Noise paths that must be skipped
    await app.request("/api/v1/health");
    await app.request("/assets/index.js");
    await app.request("/favicon.ico");
    await app.request("/api/v1/api-stats/overview");

    expect(logs.map((l) => l.route_template)).toEqual([
      "/api/v1/documents/:id",
      "/api/v1/documents/:id",
      "/_unmatched",
      "/_unmatched",
    ]);
    expect(logs[2]?.status_code).toBe(404);
    expect(logs[3]?.status_code).toBe(404);
  });

  it("enforces 403 for API Key on all 5 stats endpoints, attributes 401 invalid_key, preserves revoked snapshots, and redacts secrets", async () => {
    const { store, logs } = makeInMemoryStore();
    const collector = new ApiStatsCollector(store, { enabled: true, syncWrite: true });
    const app = makeApp(store, collector, "admin-session-token");

    // Create an API key as session
    const createRes = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer admin-session-token",
      },
      body: JSON.stringify({ name: "stats-test-key" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as ApiKeyRecord & { key: string };

    // Valid API key calls business endpoint
    const okRes = await app.request("/api/v1/settings", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(okRes.status).toBe(200);

    // Valid API key MUST get 403 on all 5 api-stats endpoints
    const statsPaths = [
      "/api/v1/api-stats/overview",
      "/api/v1/api-stats/routes",
      "/api/v1/api-stats/errors",
      "/api/v1/api-stats/api-keys",
      `/api/v1/api-stats/api-keys/${created.id}`,
    ];
    for (const p of statsPaths) {
      const forbiddenRes = await app.request(p, {
        headers: { Authorization: `Bearer ${created.key}` },
      });
      expect(forbiddenRes.status).toBe(403);
    }

    // Invalid API key gets 401 and is attributed to invalid_key
    const badKey = `${API_KEY_PREFIX}invalidsecretvalue1234567890`;
    const unauthRes = await app.request("/api/v1/settings?token=supersecret&password=123", {
      headers: {
        Authorization: `Bearer ${badKey}`,
        "User-Agent": "vitest-agent",
        "X-Forwarded-For": "10.0.0.5, 192.168.1.1",
      },
    });
    expect(unauthRes.status).toBe(401);
    expect(sanitizeControlChars("vitest-agent\n\x00")).toBe("vitest-agent");

    // Revoke the key
    const delRes = await app.request(`/api/v1/api-keys/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer admin-session-token" },
    });
    expect(delRes.status).toBe(200);

    // Revoked key attempt returns 401
    const revokedRes = await app.request("/api/v1/settings", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(revokedRes.status).toBe(401);

    // Verify redaction: NO plaintext key or secret in any stored log
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(created.key);
    expect(serialized).not.toContain(badKey);
    expect(serialized).not.toContain("admin-session-token");
    expect(serialized).not.toContain("supersecret");

    // Verify redaction helper directly
    expect(
      redactSensitiveText(`failed Bearer ${created.key} token=abc123 password=xyz`),
    ).toBe("failed Bearer [REDACTED] token=[REDACTED] password=[REDACTED]");

    // Query api-keys summary as session
    const keysStatsRes = await app.request("/api/v1/api-stats/api-keys", {
      headers: { Authorization: "Bearer admin-session-token" },
    });
    expect(keysStatsRes.status).toBe(200);
    const keysStats = (await keysStatsRes.json()) as ApiStatsApiKeysResponse;
    expect(keysStats.summary.unauthorized_401_count).toBe(2);
    expect(keysStats.summary.forbidden_403_count).toBe(5);
    expect(keysStats.items[0]?.status).toBe("revoked");
    expect(keysStats.items[0]?.api_key_prefix).toBe(created.prefix);
    expect(keysStats.items[0]?.api_key_name).toBe("stats-test-key");

    // Query __invalid__ drilldown
    const invalidDetailRes = await app.request("/api/v1/api-stats/api-keys/__invalid__", {
      headers: { Authorization: "Bearer admin-session-token" },
    });
    expect(invalidDetailRes.status).toBe(200);
    const invalidDetail = (await invalidDetailRes.json()) as ApiStatsApiKeyDetailResponse;
    expect(invalidDetail.key.status).toBe("invalid");
    expect(invalidDetail.key.total_requests).toBe(2);
    expect(invalidDetail.recent_errors).toHaveLength(2);

    // Query single revoked key drilldown
    const keyDetailRes = await app.request(`/api/v1/api-stats/api-keys/${created.id}`, {
      headers: { Authorization: "Bearer admin-session-token" },
    });
    expect(keyDetailRes.status).toBe(200);
    const keyDetail = (await keyDetailRes.json()) as ApiStatsApiKeyDetailResponse;
    expect(keyDetail.key.status).toBe("revoked");
    expect(keyDetail.key.total_requests).toBe(6); // 1 ok + 5 forbidden 403
  });

  it("computes exact latency percentiles, overview, routes sort/filter, errors, and 30-day TTL purge", async () => {
    const { store, logs } = makeInMemoryStore();
    const collector = new ApiStatsCollector(store, { enabled: true, retentionDays: 30 });
    const now = Date.now();

    // Insert 5 logs with known durations [10, 20, 30, 40, 100] and 1 expired log (35 days ago)
    await store.insertApiAccessLogs([
      {
        occurred_at: new Date(now - 35 * 86_400_000).toISOString(),
        method: "GET",
        route_template: "/api/v1/old",
        status_code: 200,
        duration_ms: 999,
        auth_type: "session",
        auth_outcome: "ok",
      },
      {
        occurred_at: new Date(now - 60_000).toISOString(),
        method: "GET",
        route_template: "/api/v1/documents/:id",
        status_code: 200,
        duration_ms: 10,
        auth_type: "session",
        auth_outcome: "ok",
      },
      {
        occurred_at: new Date(now - 50_000).toISOString(),
        method: "GET",
        route_template: "/api/v1/documents/:id",
        status_code: 200,
        duration_ms: 20,
        auth_type: "session",
        auth_outcome: "ok",
      },
      {
        occurred_at: new Date(now - 40_000).toISOString(),
        method: "GET",
        route_template: "/api/v1/documents/:id",
        status_code: 200,
        duration_ms: 30,
        auth_type: "session",
        auth_outcome: "ok",
      },
      {
        occurred_at: new Date(now - 30_000).toISOString(),
        method: "POST",
        route_template: "/api/v1/ingest/jobs/text",
        status_code: 500,
        duration_ms: 40,
        auth_type: "api_key",
        api_key_id: "k1",
        api_key_prefix: "llmwiki_sk_test",
        api_key_name: "agent",
        auth_outcome: "error_5xx",
        error_code: "internal_error",
      },
      {
        occurred_at: new Date(now - 20_000).toISOString(),
        method: "POST",
        route_template: "/api/v1/ingest/jobs/text",
        status_code: 400,
        duration_ms: 100,
        auth_type: "api_key",
        api_key_id: "k1",
        api_key_prefix: "llmwiki_sk_test",
        api_key_name: "agent",
        auth_outcome: "ok",
        error_code: "bad_request",
      },
    ]);

    // TTL purge removes only the 35-day-old row
    const purged = await collector.purgeExpired(now);
    expect(purged).toBe(1);
    expect(logs).toHaveLength(5);

    const app = makeApp(store, collector);

    // Overview: sorted durations [10, 20, 30, 40, 100] -> p50=30, p95=88, p99=97.6
    const ovRes = await app.request("/api/v1/api-stats/overview?range=1h");
    expect(ovRes.status).toBe(200);
    const ov = (await ovRes.json()) as ApiStatsOverviewResponse;
    expect(ov.capabilities).toEqual({ has_api_keys: true, scope: "global" });
    expect(ov.summary.total_requests).toBe(5);
    expect(ov.summary.p50_ms).toBe(30);
    expect(ov.summary.p95_ms).toBe(88);
    expect(ov.summary.p99_ms).toBe(97.6);
    expect(ov.summary.error_4xx_rate).toBe(20);
    expect(ov.summary.error_5xx_rate).toBe(20);
    expect(ov.summary.active_routes).toBe(2);

    // Routes sorted by error_rate
    const routesRes = await app.request("/api/v1/api-stats/routes?range=1h&sort=error_rate");
    expect(routesRes.status).toBe(200);
    const routes = (await routesRes.json()) as ApiStatsRoutesResponse;
    expect(routes.items[0]?.route_template).toBe("/api/v1/ingest/jobs/text");
    expect(routes.items[0]?.error_rate).toBe(100);

    // Errors list with filter
    const errRes = await app.request("/api/v1/api-stats/errors?range=1h&status_class=5xx");
    expect(errRes.status).toBe(200);
    const errs = (await errRes.json()) as ApiStatsErrorsResponse;
    expect(errs.items).toHaveLength(1);
    expect(errs.items[0]?.status_code).toBe(500);
    expect(errs.items[0]?.error_code).toBe("internal_error");
  });
});
