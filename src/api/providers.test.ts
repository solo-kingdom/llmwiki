import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertModelsDev } from "../llm/provider_sync.js";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import type {
  ModelInfo,
  ProviderInfo,
  ProviderInstance,
  ProviderInstanceUpdatePatch,
} from "../store/types.js";
import { MAX_INSTANCE_MODELS, normalizeInstanceModels } from "./providers.js";

function makeInMemoryProviderStore() {
  const providers = new Map<string, ProviderInfo>([
    [
      "openai",
      {
        id: "openai",
        name: "OpenAI",
        api_base: "https://api.openai.com/v1",
        api_format: "openai",
        env_key: "OPENAI_API_KEY",
        doc_url: "https://platform.openai.com/docs",
        npm: "@ai-sdk/openai",
      },
    ],
    [
      "deepseek",
      {
        id: "deepseek",
        name: "DeepSeek",
        api_base: "https://api.deepseek.com",
        api_format: "openai",
        env_key: "DEEPSEEK_API_KEY",
        doc_url: "https://api-docs.deepseek.com/",
        npm: "@ai-sdk/openai-compatible",
      },
    ],
    [
      "anthropic",
      {
        id: "anthropic",
        name: "Anthropic",
        api_base: "https://api.anthropic.com/v1",
        api_format: "anthropic",
        env_key: "ANTHROPIC_API_KEY",
        doc_url: "https://docs.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    ],
  ]);
  const modelsByProvider = new Map<string, ModelInfo[]>([
    [
      "deepseek",
      [
        {
          provider_id: "deepseek",
          model_id: "deepseek-chat",
          name: "DeepSeek Chat",
          family: "deepseek",
          context_limit: 64000,
          output_limit: 8192,
          cost_input: 0,
          cost_output: 0,
          reasoning: false,
          tool_call: true,
          attachment: false,
          modalities: "{}",
        },
      ],
    ],
  ]);
  const instances = new Map<string, ProviderInstance>();
  const config = new Map<string, string>();
  let seq = 1;

  const store = {
    getConfig: vi.fn(async (key: string) => config.get(key) ?? ""),
    setConfig: vi.fn(async (key: string, value: string) => {
      config.set(key, value);
    }),
    getAllConfig: vi.fn(async () => Object.fromEntries(config.entries())),
    countActivityLogs: vi.fn().mockResolvedValue(0),
    createActivityLog: vi.fn().mockResolvedValue(undefined),
    findApiKeyByHash: vi.fn().mockResolvedValue(null),
    touchApiKey: vi.fn().mockResolvedValue(undefined),

    listProviders: vi.fn(async () => [...providers.values()]),
    getProviderInfo: vi.fn(async (id: string) => providers.get(id) ?? null),
    listModelsByProvider: vi.fn(async (id: string) => modelsByProvider.get(id) ?? []),
    upsertProviderInfo: vi.fn(async (list: ProviderInfo[]) => {
      providers.clear();
      for (const item of list) providers.set(item.id, item);
    }),
    upsertModels: vi.fn(async (list: ModelInfo[]) => {
      modelsByProvider.clear();
      for (const item of list) {
        const cur = modelsByProvider.get(item.provider_id) ?? [];
        cur.push(item);
        modelsByProvider.set(item.provider_id, cur);
      }
    }),
    countCatalog: vi.fn(async () => {
      let modelCount = 0;
      for (const list of modelsByProvider.values()) modelCount += list.length;
      return { provider_count: providers.size, model_count: modelCount };
    }),

    createProviderInstance: vi.fn(async (inst: ProviderInstance) => {
      if (!inst.id) inst.id = `inst_${seq++}`;
      inst.created_at = "2026-11-26T00:00:00Z";
      inst.updated_at = "2026-11-26T00:00:00Z";
      instances.set(inst.id, { ...inst, models: [...inst.models] });
    }),
    getProviderInstance: vi.fn(async (id: string) => {
      const found = instances.get(id);
      return found ? { ...found, models: [...found.models] } : null;
    }),
    listProviderInstances: vi.fn(async () =>
      [...instances.values()].map((item) => ({ ...item, models: [...item.models] })),
    ),
    updateProviderInstance: vi.fn(async (id: string, patch: ProviderInstanceUpdatePatch) => {
      const cur = instances.get(id);
      if (!cur) return;
      if (patch.name !== undefined) cur.name = patch.name;
      if (patch.catalog_id !== undefined) cur.catalog_id = patch.catalog_id;
      if (patch.api_format !== undefined) cur.api_format = patch.api_format;
      if (patch.base_url !== undefined) cur.base_url = patch.base_url;
      if (patch.api_key !== undefined && patch.api_key.trim() !== "") cur.api_key = patch.api_key;
      if (patch.models !== undefined) cur.models = [...patch.models];
      cur.updated_at = "2026-11-26T00:01:00Z";
    }),
    deleteProviderInstance: vi.fn(async (id: string) => {
      if (!instances.delete(id)) throw new Error(`provider instance not found: ${id}`);
    }),
  } as unknown as Store;

  return { store, config, instances };
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

describe("Provider catalog, instances, discovery & settings linkage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("infers api_format and npm in convertModelsDev", () => {
    const { providers, models } = convertModelsDev({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        npm: "@ai-sdk/anthropic",
        models: { "claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" } },
      },
      zhipuai: {
        id: "zhipuai",
        name: "Zhipu AI",
        api: "https://open.bigmodel.cn/api/paas/v4",
        npm: "@ai-sdk/openai-compatible",
        models: { "glm-4.5": { id: "glm-4.5", name: "GLM-4.5" } },
      },
      ollama: {
        id: "ollama",
        name: "Ollama",
        models: { "llama3.2": { id: "llama3.2", name: "Llama 3.2" } },
      },
    });

    expect(providers.find((p) => p.id === "anthropic")?.api_format).toBe("anthropic");
    expect(providers.find((p) => p.id === "zhipuai")?.api_format).toBe("openai");
    expect(providers.find((p) => p.id === "zhipuai")?.npm).toBe("@ai-sdk/openai-compatible");
    expect(providers.find((p) => p.id === "ollama")?.api_format).toBe("ollama");
    expect(models).toHaveLength(3);
  });

  it("normalizes instance models and enforces limits", () => {
    expect(normalizeInstanceModels([" gpt-4o ", "gpt-4o", "o3-mini"])).toEqual([
      "gpt-4o",
      "o3-mini",
    ]);
    expect(() => normalizeInstanceModels([""])).toThrow();
    const tooMany = Array.from({ length: MAX_INSTANCE_MODELS + 1 }, (_, i) => `m-${i}`);
    expect(() => normalizeInstanceModels(tooMany)).toThrow();
  });

  it("creates, updates, redacts api_key, and supports custom provider", async () => {
    const { store, instances } = makeInMemoryProviderStore();
    const app = makeApp(store);

    const createRes = await app.request("/api/v1/provider-instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "DeepSeek Anthropic",
        catalog_id: "deepseek",
        api_format: "anthropic",
        base_url: "https://api.deepseek.com/anthropic",
        api_key: "sk-secret-123456",
        models: ["deepseek-chat", "deepseek-reasoner", "deepseek-chat"],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { instance: ProviderInstance };
    expect(created.instance.api_key).toBe("");
    expect(created.instance.api_key_masked).not.toBe("");
    expect(created.instance.api_format).toBe("anthropic");
    expect(created.instance.models).toEqual(["deepseek-chat", "deepseek-reasoner"]);

    // Updating without api_key preserves the stored key
    const updateRes = await app.request(`/api/v1/provider-instances/${created.instance.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["deepseek-reasoner"],
      }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { instance: ProviderInstance };
    expect(updated.instance.models).toEqual(["deepseek-reasoner"]);
    expect(instances.get(created.instance.id)?.api_key).toBe("sk-secret-123456");

    // Custom provider requires base_url
    const customInvalid = await app.request("/api/v1/provider-instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Local Gateway",
        catalog_id: "custom",
        api_format: "openai",
        models: ["local-model"],
      }),
    });
    expect(customInvalid.status).toBe(400);

    const customOk = await app.request("/api/v1/provider-instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Local Gateway",
        catalog_id: "custom",
        api_format: "openai",
        base_url: "http://127.0.0.1:8080/v1",
        api_key: "sk-local",
        models: ["local-model"],
      }),
    });
    expect(customOk.status).toBe(201);
  });

  it("discovers live /models and tests draft or stored connections", async () => {
    const { store } = makeInMemoryProviderStore();
    const app = makeApp(store);

    const createRes = await app.request("/api/v1/provider-instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Stored Anthropic",
        catalog_id: "custom",
        api_format: "anthropic",
        base_url: "https://api.example.test/anthropic",
        api_key: "sk-stored-key",
        models: ["claude-sonnet-4-5"],
      }),
    });
    const created = (await createRes.json()) as { instance: ProviderInstance };

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.example.test/anthropic/v1/models") {
        const headers = init?.headers as Record<string, string>;
        if (headers["x-api-key"] === "sk-bad") {
          return new Response("unauthorized", { status: 401 });
        }
        return new Response(
          JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }, { id: "claude-opus-4-1" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Discover using stored instance credential
    const discoverRes = await app.request("/api/v1/provider-instances/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: created.instance.id }),
    });
    expect(discoverRes.status).toBe(200);
    const discovered = (await discoverRes.json()) as { models: string[] };
    expect(discovered.models).toEqual(["claude-sonnet-4-5", "claude-opus-4-1"]);

    // Test draft with bad key -> unauthorized
    const testUnauthorized = await app.request("/api/v1/provider-instances/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_format: "anthropic",
        base_url: "https://api.example.test/anthropic",
        api_key: "sk-bad",
      }),
    });
    expect(testUnauthorized.status).toBe(200);
    expect(((await testUnauthorized.json()) as { status: string }).status).toBe("unauthorized");

    // Test stored instance -> ok
    const testOk = await app.request("/api/v1/provider-instances/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance_id: created.instance.id }),
    });
    expect(testOk.status).toBe(200);
    expect(((await testOk.json()) as { status: string }).status).toBe("ok");
  });

  it("reports catalog-status, syncs models.dev, and persists last_instance_id & job_instance_id", async () => {
    const { store } = makeInMemoryProviderStore();
    const app = makeApp(store);

    const statusBefore = await app.request("/api/v1/providers/catalog-status");
    expect(statusBefore.status).toBe(200);
    expect(((await statusBefore.json()) as { availability: string }).availability).toBe("fallback");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            openai: {
              id: "openai",
              name: "OpenAI",
              npm: "@ai-sdk/openai",
              models: { "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" } },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const syncRes = await app.request("/api/v1/providers/sync", { method: "POST" });
    expect(syncRes.status).toBe(200);
    const synced = (await syncRes.json()) as { availability: string; provider_count: number };
    expect(synced.availability).toBe("available");
    expect(synced.provider_count).toBe(1);

    const settingsRes = await app.request("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        last_instance_id: "inst_1",
        last_model: "gpt-4.1",
        job_instance_id: "inst_2",
        job_model: "deepseek-chat",
      }),
    });
    expect(settingsRes.status).toBe(200);
    const settingsJson = (await settingsRes.json()) as Record<string, string>;
    expect(settingsJson.last_instance_id).toBe("inst_1");
    expect(settingsJson.last_model).toBe("gpt-4.1");
    expect(settingsJson.job_instance_id).toBe("inst_2");
    expect(settingsJson.job_model).toBe("deepseek-chat");
  });
});
