import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";

function makeStore() {
  const config = new Map<string, string>();
  const store = {
    getConfig: vi.fn(async (key: string) => config.get(key) ?? ""),
    setConfig: vi.fn(async (key: string, value: string) => {
      config.set(key, value);
    }),
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    listDocumentsFiltered: vi.fn().mockResolvedValue([]),
    listDocuments: vi.fn().mockResolvedValue([]),
    listFolders: vi.fn().mockResolvedValue([]),
    getWorkspace: vi.fn().mockResolvedValue(null),
    trimActivityLogs: vi.fn().mockResolvedValue(0),
    trimAllIngestJobEvents: vi.fn().mockResolvedValue(undefined),
  } as unknown as Store;
  return { store, config };
}

function makeApp(store: Store) {
  return createApp({
    db: store,
    token: "",
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });
}

type App = ReturnType<typeof createApp>;

async function putSettings(app: App, body: Record<string, unknown>) {
  return app.request("/api/v1/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("settings: ingest parallelism", () => {
  it("defaults to serial processing with the historical concurrency default", async () => {
    const { store } = makeStore();
    const app = makeApp(store);

    const res = await app.request("/api/v1/settings");
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.job_parallel_enabled).toBe("false");
    expect(body.job_max_concurrent).toBe("3");
    expect(body.structure_policy_mode).toBe("legacy");
  });

  it("stores the switch canonically and reads back the new values", async () => {
    const { store, config } = makeStore();
    const app = makeApp(store);

    const on = await putSettings(app, { job_parallel_enabled: true, job_max_concurrent: 12 });
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as Record<string, unknown>;
    expect(onBody.job_parallel_enabled).toBe("true");
    expect(onBody.job_max_concurrent).toBe("12");
    expect(config.get("job_parallel_enabled")).toBe("true");
    expect(config.get("job_max_concurrent")).toBe("12");

    const off = await putSettings(app, { job_parallel_enabled: false });
    expect(off.status).toBe(200);
    expect(config.get("job_parallel_enabled")).toBe("false");
    expect(((await off.json()) as Record<string, unknown>).job_parallel_enabled).toBe("false");
  });

  it("rejects invalid values without changing the stored settings", async () => {
    const { store, config } = makeStore();
    const app = makeApp(store);

    for (const body of [
      { job_max_concurrent: 0 },
      { job_max_concurrent: 33 },
      { job_max_concurrent: 8.5 },
      { job_max_concurrent: "lots" },
      { job_parallel_enabled: "yes" },
    ]) {
      const res = await putSettings(app, body);
      expect(res.status).toBe(400);
    }
    expect(config.has("job_max_concurrent")).toBe(false);
    expect(config.has("job_parallel_enabled")).toBe(false);
  });

  it("validates and stores the structure placement policy", async () => {
    const { store, config } = makeStore();
    const app = makeApp(store);

    const res = await putSettings(app, { structure_policy_mode: "REPORT" });
    expect(res.status).toBe(200);
    expect(config.get("structure_policy_mode")).toBe("report");
    expect(((await res.json()) as Record<string, unknown>).structure_policy_mode).toBe("report");

    const invalid = await putSettings(app, { structure_policy_mode: "strict" });
    expect(invalid.status).toBe(400);
    expect(config.get("structure_policy_mode")).toBe("report");
  });

  it("keeps API keys able to toggle the switch (not a credential)", async () => {
    const { store } = makeStore();
    const app = makeApp(store);

    const res = await putSettings(app, { job_parallel_enabled: true });
    expect(res.status).toBe(200);
  });
});
