import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import {
  CONFIG_HELA_NOTIFY_API_KEY,
  CONFIG_HELA_NOTIFY_BASE_URL,
  CONFIG_HELA_NOTIFY_ENABLED,
  CONFIG_HELA_NOTIFY_EVENTS,
} from "../store/types.js";
import {
  normalizeHelaBaseUrl,
  notifyHelaEvent,
  parseHelaNotifyEvents,
  resetHelaNotifyDedupeForTests,
  resolveHelaConfig,
  sendHelaTestNotification,
} from "./hela.js";

function makeStore(initial: Record<string, string> = {}): Store {
  const map = new Map(Object.entries(initial));
  return {
    getConfig: vi.fn(async (key: string) => map.get(key) ?? ""),
  } as unknown as Store;
}

describe("hela notify", () => {
  beforeEach(() => {
    resetHelaNotifyDedupeForTests();
  });

  it("validates URL and event lists", () => {
    expect(normalizeHelaBaseUrl("http://hela.example.com/")).toBe("http://hela.example.com");
    expect(() => normalizeHelaBaseUrl("ftp://hela.example.com")).toThrow("http:// or https://");
    expect(parseHelaNotifyEvents("")).toEqual(["ingest_failed", "review_required", "server_error"]);
    expect(parseHelaNotifyEvents("none")).toEqual([]);
    expect(parseHelaNotifyEvents("ingest_failed, server_error, ingest_failed")).toEqual([
      "ingest_failed",
      "server_error",
    ]);
    expect(() => parseHelaNotifyEvents("unknown_event")).toThrow("unsupported");
  });

  it("prefers DB settings over env and auto-enables when env provides both base and key", async () => {
    const envOnly = await resolveHelaConfig(
      makeStore(),
      {},
      {
        LLMWIKI_HELA_API_BASE: "http://env.hela.example.com/",
        LLMWIKI_HELA_API_KEY: "env-secret-key",
      },
    );
    expect(envOnly.enabled).toBe(true);
    expect(envOnly.source).toBe("env");
    expect(envOnly.baseUrl).toBe("http://env.hela.example.com");
    expect(envOnly.apiKey).toBe("env-secret-key");

    const dbOverride = await resolveHelaConfig(
      makeStore({
        [CONFIG_HELA_NOTIFY_ENABLED]: "false",
        [CONFIG_HELA_NOTIFY_BASE_URL]: "http://db.hela.example.com",
        [CONFIG_HELA_NOTIFY_API_KEY]: "db-secret-key",
      }),
      {},
      {
        LLMWIKI_HELA_API_BASE: "http://env.hela.example.com",
        LLMWIKI_HELA_API_KEY: "env-secret-key",
      },
    );
    expect(dbOverride.enabled).toBe(false);
    expect(dbOverride.source).toBe("settings");
    expect(dbOverride.baseUrl).toBe("http://db.hela.example.com");
    expect(dbOverride.apiKey).toBe("db-secret-key");
  });

  it("posts markdown message to POST /api/v1/messages with Bearer auth and deduplicates within 60s", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-1", createdAt: "2026-11-28T10:00:00Z" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const db = makeStore({
      [CONFIG_HELA_NOTIFY_ENABLED]: "true",
      [CONFIG_HELA_NOTIFY_BASE_URL]: "http://hela.example.com/",
      [CONFIG_HELA_NOTIFY_API_KEY]: "hela_sk_123",
    });

    let nowMs = 1_000_000;
    const ok1 = await notifyHelaEvent(
      db,
      {
        type: "ingest_failed",
        title: "摄入任务失败",
        content: "job-1 failed",
        dedupeKey: "ingest:job-1",
      },
      { fetchImpl: fetchMock as unknown as typeof fetch, now: () => nowMs, env: {} },
    );
    expect(ok1).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://hela.example.com/api/v1/messages");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toEqual({
      Authorization: "Bearer hela_sk_123",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      title: "摄入任务失败",
      content: "job-1 failed",
      format: "markdown",
    });

    // Suppressed within 60s
    nowMs += 30_000;
    const ok2 = await notifyHelaEvent(
      db,
      { type: "ingest_failed", title: "摄入任务失败", content: "job-1 failed", dedupeKey: "ingest:job-1" },
      { fetchImpl: fetchMock as unknown as typeof fetch, now: () => nowMs, env: {} },
    );
    expect(ok2).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Allowed after 60s
    nowMs += 35_000;
    const ok3 = await notifyHelaEvent(
      db,
      { type: "ingest_failed", title: "摄入任务失败", content: "job-1 failed", dedupeKey: "ingest:job-1" },
      { fetchImpl: fetchMock as unknown as typeof fetch, now: () => nowMs, env: {} },
    );
    expect(ok3).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on 5xx/429, does not retry on 401, and never throws on network error", async () => {
    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "msg-2" }), { status: 201 }));
    const db = makeStore({
      [CONFIG_HELA_NOTIFY_ENABLED]: "true",
      [CONFIG_HELA_NOTIFY_BASE_URL]: "http://hela.example.com",
      [CONFIG_HELA_NOTIFY_API_KEY]: "hela_sk_123",
      [CONFIG_HELA_NOTIFY_EVENTS]: "ingest_failed,server_error",
    });

    const retried = await notifyHelaEvent(
      db,
      { type: "server_error", title: "服务异常", content: "boom" },
      { fetchImpl: retryFetch as unknown as typeof fetch, retryDelayMs: 0, env: {} },
    );
    expect(retried).toBe(true);
    expect(retryFetch).toHaveBeenCalledTimes(2);

    const authFailFetch = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const authFail = await notifyHelaEvent(
      db,
      { type: "ingest_failed", title: "失败", content: "err" },
      { fetchImpl: authFailFetch as unknown as typeof fetch, retryDelayMs: 0, env: {} },
    );
    expect(authFail).toBe(false);
    expect(authFailFetch).toHaveBeenCalledTimes(1);

    const networkFailFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const netFail = await notifyHelaEvent(
      db,
      { type: "ingest_failed", title: "失败", content: "err" },
      { fetchImpl: networkFailFetch as unknown as typeof fetch, retryDelayMs: 0, env: {} },
    );
    expect(netFail).toBe(false);
    expect(networkFailFetch).toHaveBeenCalledTimes(2);
  });

  it("skips unsubscribed event types and supports test notification", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg-test" }), { status: 201 }));
    const db = makeStore({
      [CONFIG_HELA_NOTIFY_ENABLED]: "true",
      [CONFIG_HELA_NOTIFY_BASE_URL]: "http://hela.example.com",
      [CONFIG_HELA_NOTIFY_API_KEY]: "hela_sk_123",
      [CONFIG_HELA_NOTIFY_EVENTS]: "ingest_failed",
    });

    const skipped = await notifyHelaEvent(
      db,
      { type: "review_required", title: "需审阅", content: "review" },
      { fetchImpl: fetchMock as unknown as typeof fetch, env: {} },
    );
    expect(skipped).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const testRes = await sendHelaTestNotification(
      makeStore(),
      { baseUrl: "http://draft.hela.example.com", apiKey: "draft-key" },
      { fetchImpl: fetchMock as unknown as typeof fetch, retryDelayMs: 0, env: {} },
    );
    expect(testRes.ok).toBe(true);
    expect(testRes.message_id).toBe("msg-test");
    expect(testRes.target).toBe("http://draft.hela.example.com");

    const missingCfg = await sendHelaTestNotification(makeStore(), {}, { env: {} });
    expect(missingCfg.ok).toBe(false);
  });
});
