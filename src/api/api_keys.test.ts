import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import { API_KEY_PREFIX, MAX_API_KEYS, type ApiKeyRecord } from "../store/types.js";
import { hashApiKey } from "./api_keys.js";

interface StoredKey extends ApiKeyRecord {
  key_hash: string;
}

function makeInMemoryStore(initialKeys: StoredKey[] = []) {
  const keys = new Map<string, StoredKey>();
  for (const item of initialKeys) keys.set(item.id, { ...item });
  const config = new Map<string, string>();
  const touched: string[] = [];

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

    createApiKey: vi.fn(async (input: { id: string; name: string; key_hash: string; prefix: string }) => {
      const record: StoredKey = {
        id: input.id,
        name: input.name,
        prefix: input.prefix,
        key_hash: input.key_hash,
        created_at: "2026-11-25 14:40:00",
        last_used_at: null,
      };
      keys.set(record.id, record);
      return toPublic(record);
    }),
    listApiKeys: vi.fn(async () => [...keys.values()].map(toPublic)),
    countApiKeys: vi.fn(async () => keys.size),
    findApiKeyByHash: vi.fn(async (keyHash: string) => {
      for (const item of keys.values()) {
        if (item.key_hash === keyHash) return toPublic(item);
      }
      return null;
    }),
    touchApiKey: vi.fn(async (id: string) => {
      touched.push(id);
      const item = keys.get(id);
      if (item) item.last_used_at = "2026-11-25 14:45:00";
    }),
    deleteApiKey: vi.fn(async (id: string) => keys.delete(id)),
  } as unknown as Store;

  return { store, keys, touched };
}

function toPublic(item: StoredKey): ApiKeyRecord {
  return {
    id: item.id,
    name: item.name,
    prefix: item.prefix,
    created_at: item.created_at,
    last_used_at: item.last_used_at,
  };
}

function makeApp(store: Store, token = "") {
  return createApp({
    db: store,
    token,
    publicWiki: true,
    noMcp: true,
    mcpAllowWrite: false,
    workspace: "",
    webRoot: "/tmp/nonexistent-web",
    skillsRoot: path.resolve(process.cwd(), "skills"),
  });
}

describe("API Keys management & auth boundaries", () => {
  it("creates, lists without plaintext/hash, authenticates business APIs, and revokes on delete", async () => {
    const { store, keys, touched } = makeInMemoryStore();
    const app = makeApp(store);

    const createRes = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "personal-agent" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as ApiKeyRecord & { key: string };
    expect(created.name).toBe("personal-agent");
    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.prefix).toBe(created.key.slice(0, API_KEY_PREFIX.length + 4));

    // Only SHA-256 hash is stored
    const stored = keys.get(created.id);
    expect(stored?.key_hash).toBe(hashApiKey(created.key));
    expect(stored?.key_hash).not.toBe(created.key);

    // Listing never returns plaintext or hash
    const listRes = await app.request("/api/v1/api-keys");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { api_keys: Array<Record<string, unknown>> };
    expect(listBody.api_keys).toHaveLength(1);
    expect(listBody.api_keys[0]?.key).toBeUndefined();
    expect(listBody.api_keys[0]?.key_hash).toBeUndefined();

    // API Key can call business endpoints and touches last_used_at
    const settingsRes = await app.request("/api/v1/settings", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(settingsRes.status).toBe(200);
    expect(touched).toContain(created.id);

    // Non-credential settings update is allowed for API Key
    const updateUiRes = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${created.key}`,
      },
      body: JSON.stringify({ ui_language: "en" }),
    });
    expect(updateUiRes.status).toBe(200);

    // Delete revokes immediately
    const delRes = await app.request(`/api/v1/api-keys/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const delAgain = await app.request(`/api/v1/api-keys/${created.id}`, { method: "DELETE" });
    expect(delAgain.status).toBe(404);

    const afterRevoke = await app.request("/api/v1/settings", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("blocks API Keys from managing credentials with 403", async () => {
    const { store } = makeInMemoryStore();
    const app = makeApp(store);

    const createRes = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "agent-1" }),
    });
    const created = (await createRes.json()) as { id: string; key: string };
    const authHeader = { Authorization: `Bearer ${created.key}` };

    expect((await app.request("/api/v1/api-keys", { headers: authHeader })).status).toBe(403);
    expect(
      (
        await app.request("/api/v1/api-keys", {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "nested" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await app.request(`/api/v1/api-keys/${created.id}`, { method: "DELETE", headers: authHeader })).status,
    ).toBe(403);

    // Modifying api_token via PUT /api/v1/settings is also 403 for API Key
    const tokenRes = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ api_token: "new-secret-token-123" }),
    });
    expect(tokenRes.status).toBe(403);
  });

  it("validates name and enforces MAX_API_KEYS limit", async () => {
    const { store } = makeInMemoryStore();
    const app = makeApp(store);

    const emptyName = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(emptyName.status).toBe(400);

    const longName = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a".repeat(65) }),
    });
    expect(longName.status).toBe(400);

    for (let i = 0; i < MAX_API_KEYS; i += 1) {
      const res = await app.request("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `k-${i}` }),
      });
      expect(res.status).toBe(201);
    }

    const overLimit = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "overflow" }),
    });
    expect(overLimit.status).toBe(400);
  });

  it("serves /skill.md and /api/v1/skills without auth even when legacy token is configured", async () => {
    const { store } = makeInMemoryStore();
    const app = makeApp(store, "super-secret-legacy-token");

    // Protected endpoint rejects unauthenticated calls
    expect((await app.request("/api/v1/settings")).status).toBe(401);
    expect((await app.request("/api/v1/settings", { headers: { Authorization: "Bearer llmwiki_sk_invalid" } })).status).toBe(401);

    // Legacy token still works
    expect(
      (await app.request("/api/v1/settings", { headers: { Authorization: "Bearer super-secret-legacy-token" } }))
        .status,
    ).toBe(200);

    // Public skill endpoints are unauthenticated and carry version declaration
    const skillRes = await app.request("/skill.md");
    expect(skillRes.status).toBe(200);
    const skillText = await skillRes.text();
    expect(skillText).toContain("skill: project-design-patterns@1.1.0");
    expect(skillText).toContain("llmwiki_sk_");

    const indexRes = await app.request("/api/v1/skills");
    expect(indexRes.status).toBe(200);
    const indexJson = (await indexRes.json()) as { entry: string; skills: Array<{ name: string }> };
    expect(indexJson.entry).toBe("/skill.md");
    expect(indexJson.skills.some((s) => s.name === "llmwiki")).toBe(true);
  });
});
