import type { Context } from "hono";
import { Client, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "../llm/client.js";
import { syncModelsDev, type CatalogSyncResult } from "../llm/provider_sync.js";
import { record } from "../activity/index.js";
import type { ProviderInstance, ProviderInstanceUpdatePatch } from "../store/types.js";
import {
  getID,
  maskKey,
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

export const MAX_INSTANCE_MODELS = 64;
export const MAX_MODEL_ID_LENGTH = 256;
const VALID_API_FORMATS = new Set(["openai", "anthropic", "ollama"]);

interface ProviderInstanceRequest {
  name?: string;
  catalog_id?: string;
  api_format?: string;
  api_key?: string;
  base_url?: string;
  models?: unknown;
}

interface DiscoverModelsRequest {
  instance_id?: string;
  catalog_id?: string;
  api_format?: string;
  base_url?: string;
  api_key?: string;
}

interface TestProviderRequest {
  instance_id?: string;
  catalog_id?: string;
  api_format?: string;
  base_url?: string;
  api_key?: string;
  model_id?: string;
}

interface ProviderCheckResponse {
  status: string;
  message: string;
  details: {
    has_api_key: boolean;
    has_base_url: boolean;
    reachable: boolean;
    catalog_id: string;
  };
}

export function normalizeInstanceModels(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("models must be an array of strings");
  }
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new Error("models entries must be strings");
    }
    const id = item.trim();
    if (!id) {
      throw new Error("models entries must not be empty");
    }
    if (id.length > MAX_MODEL_ID_LENGTH) {
      throw new Error(`model id exceeds ${MAX_MODEL_ID_LENGTH} characters`);
    }
    if (!result.includes(id)) {
      result.push(id);
    }
    if (result.length > MAX_INSTANCE_MODELS) {
      throw new Error(`models cannot exceed ${MAX_INSTANCE_MODELS} entries`);
    }
  }
  return result;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseOptionalLimit(c: Context): number | undefined {
  const raw = c.req.query("limit");
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function redactInstance(instance: ProviderInstance) {
  return {
    ...instance,
    api_key: "",
    api_key_masked: maskKey(instance.api_key),
  };
}

export function providersApi(ctx: ApiContext) {
  let inflightSync: Promise<CatalogSyncResult> | null = null;

  async function buildCatalogStatus() {
    const counts = await ctx.db.countCatalog();
    const syncedAt = await ctx.db.getConfig("models_synced_at");
    const lastError = await ctx.db.getConfig("models_sync_error");
    const availability =
      counts.provider_count === 0
        ? "empty"
        : syncedAt.trim() !== ""
          ? "available"
          : "fallback";
    return {
      availability,
      provider_count: counts.provider_count,
      model_count: counts.model_count,
      synced_at: syncedAt,
      last_error: lastError,
    };
  }

  async function resolveProbeParams(input: {
    instanceId?: string;
    catalogId?: string;
    apiFormat?: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<{
    catalogId: string;
    apiFormat: string;
    baseUrl: string;
    apiKey: string;
  }> {
    let existing: ProviderInstance | null = null;
    if (input.instanceId?.trim()) {
      existing = await ctx.db.getProviderInstance(input.instanceId.trim());
      if (!existing) {
        throw new Error("provider instance not found");
      }
    }
    const catalogId = (input.catalogId ?? existing?.catalog_id ?? "custom").trim() || "custom";
    const providerInfo =
      catalogId !== "custom" ? await ctx.db.getProviderInfo(catalogId) : null;
    const apiFormat =
      input.apiFormat?.trim() ||
      existing?.api_format?.trim() ||
      providerInfo?.api_format ||
      "openai";
    const baseUrl =
      input.baseUrl?.trim() ||
      existing?.base_url?.trim() ||
      providerInfo?.api_base ||
      "";
    const apiKey =
      input.apiKey !== undefined && input.apiKey.trim() !== ""
        ? input.apiKey
        : (existing?.api_key ?? "");
    return { catalogId, apiFormat, baseUrl, apiKey };
  }

  async function checkInstance(
    instance: ProviderInstance,
    signal?: AbortSignal,
  ): Promise<ProviderCheckResponse> {
    const providerInfo =
      instance.catalog_id && instance.catalog_id !== "custom"
        ? await ctx.db.getProviderInfo(instance.catalog_id)
        : null;
    const apiFormat =
      instance.api_format.trim() || providerInfo?.api_format || "openai";
    const baseUrl = instance.base_url.trim() || providerInfo?.api_base || "";

    const response: ProviderCheckResponse = {
      status: "ok",
      message: "连接正常",
      details: {
        has_api_key: Boolean(instance.api_key.trim()),
        has_base_url: Boolean(baseUrl),
        reachable: false,
        catalog_id: instance.catalog_id,
      },
    };
    if (apiFormat !== "ollama" && !response.details.has_api_key) {
      return { ...response, status: "error", message: "未设置 API Key" };
    }
    if (!response.details.has_base_url) {
      return { ...response, status: "error", message: "未设置 Base URL" };
    }
    const client = new Client({
      provider: apiFormat,
      baseUrl,
      apiKey: instance.api_key,
      model: instance.models[0] || "probe",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    });
    try {
      await client.probe(signal);
    } catch (error) {
      return { ...response, status: "error", message: errorMessage(error) };
    }
    response.details.reachable = true;
    return response;
  }

  return {
    async listProviders(c: Context): Promise<Response> {
      try {
        const q = (c.req.query("q") ?? "").trim().toLowerCase();
        const limit = parseOptionalLimit(c);
        let providers = await ctx.db.listProviders();
        if (q) {
          providers = providers.filter(
            (p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
          );
        }
        if (limit !== undefined) {
          providers = providers.slice(0, limit);
        }
        return writeJson(
          c,
          200,
          providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            api_base: provider.api_base,
            api_format: provider.api_format,
            env_key: provider.env_key,
            doc_url: provider.doc_url,
            npm: provider.npm ?? "",
          })),
        );
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async listProviderModels(c: Context): Promise<Response> {
      const providerId = getID(c);
      if (!providerId) return writeError(c, 400, "provider id is required");
      try {
        const q = (c.req.query("q") ?? "").trim().toLowerCase();
        const limit = parseOptionalLimit(c);
        let models = await ctx.db.listModelsByProvider(providerId);
        if (q) {
          models = models.filter(
            (m) => m.model_id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
          );
        }
        if (limit !== undefined) {
          models = models.slice(0, limit);
        }
        return writeJson(
          c,
          200,
          models.map((model) => ({
            provider_id: model.provider_id,
            model_id: model.model_id,
            name: model.name,
            family: model.family,
            context_limit: model.context_limit,
            output_limit: model.output_limit,
            cost_input: model.cost_input,
            cost_output: model.cost_output,
            reasoning: model.reasoning,
            tool_call: model.tool_call,
            attachment: model.attachment,
          })),
        );
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getCatalogStatus(c: Context): Promise<Response> {
      try {
        return writeJson(c, 200, await buildCatalogStatus());
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async syncProviders(c: Context): Promise<Response> {
      try {
        if (!inflightSync) {
          inflightSync = syncModelsDev(ctx.db, c.req.raw.signal).finally(() => {
            inflightSync = null;
          });
        }
        await inflightSync;
        return writeJson(c, 200, await buildCatalogStatus());
      } catch (error) {
        return writeError(c, 502, `models.dev 同步失败：${errorMessage(error)}`);
      }
    },

    async createProviderInstance(c: Context): Promise<Response> {
      const req = await readJsonBody<ProviderInstanceRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      const catalogId = (req.catalog_id ?? "").trim() || "custom";

      let requestedFormat = "";
      if (req.api_format !== undefined) {
        requestedFormat = req.api_format.trim();
        if (requestedFormat && !VALID_API_FORMATS.has(requestedFormat)) {
          return writeError(c, 400, `invalid api_format: ${requestedFormat}`);
        }
      }

      let models: string[];
      try {
        models = normalizeInstanceModels(req.models);
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }

      try {
        const providerInfo =
          catalogId === "custom" ? null : await ctx.db.getProviderInfo(catalogId);
        if (catalogId !== "custom" && !providerInfo) {
          return writeError(c, 400, `unknown provider: ${catalogId}`);
        }

        const apiFormat = requestedFormat || providerInfo?.api_format || "openai";
        const baseUrl = (req.base_url ?? "").trim() || providerInfo?.api_base || "";
        if (catalogId === "custom" && !baseUrl) {
          return writeError(c, 400, "base_url is required for custom provider");
        }
        if (baseUrl && !isValidHttpUrl(baseUrl)) {
          return writeError(c, 400, "base_url must be a valid http(s) URL");
        }

        const name = (req.name ?? "").trim() || providerInfo?.name || "";
        if (!name) {
          return writeError(c, 400, "name is required");
        }

        const instance: ProviderInstance = {
          id: "",
          name,
          catalog_id: catalogId,
          api_format: apiFormat,
          api_key: req.api_key ?? "",
          base_url: baseUrl,
          models,
          created_at: "",
          updated_at: "",
        };
        await ctx.db.createProviderInstance(instance);
        record(ctx.db, {
          level: "info",
          category: "provider",
          action: "instance_created",
          message: `已创建 Provider 实例：${instance.name}`,
          resourceType: "provider_instance",
          resourceId: instance.id,
          status: "success",
          source: "api",
          details: {
            instance_id: instance.id,
            name: instance.name,
            catalog_id: instance.catalog_id,
            api_format: instance.api_format,
            model_count: instance.models.length,
          },
        });
        return writeJson(c, 201, { instance: redactInstance(instance) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async listProviderInstances(c: Context): Promise<Response> {
      try {
        const instances = await ctx.db.listProviderInstances();
        return writeJson(c, 200, {
          instances: instances.map(redactInstance),
        });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getProviderInstance(c: Context): Promise<Response> {
      try {
        const instance = await ctx.db.getProviderInstance(getID(c));
        if (!instance) return writeError(c, 404, "provider instance not found");
        return writeJson(c, 200, { instance: redactInstance(instance) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async updateProviderInstance(c: Context): Promise<Response> {
      const id = getID(c);
      try {
        const existing = await ctx.db.getProviderInstance(id);
        if (!existing) return writeError(c, 404, "provider instance not found");
        const req = await readJsonBody<ProviderInstanceRequest>(c);
        if (!req) return writeError(c, 400, "invalid request body");

        const patch: ProviderInstanceUpdatePatch = {};
        if (req.name !== undefined) {
          const trimmed = req.name.trim();
          if (!trimmed) return writeError(c, 400, "name cannot be empty");
          patch.name = trimmed;
        }
        if (req.catalog_id !== undefined) {
          const catalogId = req.catalog_id.trim() || "custom";
          if (catalogId !== "custom" && catalogId !== existing.catalog_id) {
            const providerInfo = await ctx.db.getProviderInfo(catalogId);
            if (!providerInfo) return writeError(c, 400, `unknown provider: ${catalogId}`);
          }
          patch.catalog_id = catalogId;
        }
        if (req.api_format !== undefined) {
          const fmt = req.api_format.trim();
          if (!VALID_API_FORMATS.has(fmt)) {
            return writeError(c, 400, `invalid api_format: ${fmt}`);
          }
          patch.api_format = fmt;
        }
        if (req.base_url !== undefined) {
          const url = req.base_url.trim();
          if (url && !isValidHttpUrl(url)) {
            return writeError(c, 400, "base_url must be a valid http(s) URL");
          }
          patch.base_url = url;
        }
        if (req.api_key !== undefined && req.api_key.trim() !== "") {
          patch.api_key = req.api_key;
        }
        if (req.models !== undefined) {
          try {
            patch.models = normalizeInstanceModels(req.models);
          } catch (error) {
            return writeError(c, 400, errorMessage(error));
          }
        }

        await ctx.db.updateProviderInstance(id, patch);
        const updated = await ctx.db.getProviderInstance(id);
        if (!updated) return writeError(c, 404, "provider instance not found");
        record(ctx.db, {
          level: "info",
          category: "provider",
          action: "instance_updated",
          message: `已更新 Provider 实例：${updated.name}`,
          resourceType: "provider_instance",
          resourceId: updated.id,
          status: "success",
          source: "api",
          details: { instance_id: updated.id, name: updated.name, catalog_id: updated.catalog_id },
        });
        return writeJson(c, 200, { instance: redactInstance(updated) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async deleteProviderInstance(c: Context): Promise<Response> {
      const id = getID(c);
      try {
        const existing = await ctx.db.getProviderInstance(id);
        await ctx.db.deleteProviderInstance(id);
        const name = existing?.name ?? id;
        record(ctx.db, {
          level: "info",
          category: "provider",
          action: "instance_deleted",
          message: `已删除 Provider 实例：${name}`,
          resourceType: "provider_instance",
          resourceId: id,
          status: "success",
          source: "api",
          details: { instance_id: id, name },
        });
        return writeJson(c, 200, { status: "deleted" });
      } catch (error) {
        if (errorMessage(error).includes("not found")) return writeError(c, 404, errorMessage(error));
        return writeError(c, 500, errorMessage(error));
      }
    },

    async discoverInstanceModels(c: Context): Promise<Response> {
      const req = await readJsonBody<DiscoverModelsRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      let resolved;
      try {
        resolved = await resolveProbeParams({
          instanceId: req.instance_id,
          catalogId: req.catalog_id,
          apiFormat: req.api_format,
          baseUrl: req.base_url,
          apiKey: req.api_key,
        });
      } catch (error) {
        const msg = errorMessage(error);
        return writeError(c, msg.includes("not found") ? 404 : 400, msg);
      }

      if (!VALID_API_FORMATS.has(resolved.apiFormat)) {
        return writeError(c, 400, `invalid api_format: ${resolved.apiFormat}`);
      }
      if (!resolved.baseUrl || !isValidHttpUrl(resolved.baseUrl)) {
        return writeError(c, 400, "base_url must be a valid http(s) URL");
      }

      const client = new Client({
        provider: resolved.apiFormat,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: "probe",
        timeoutMs: DEFAULT_TIMEOUT_MS,
        streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      });
      try {
        const models = await client.listModels(c.req.raw.signal);
        return writeJson(c, 200, {
          models,
          fetched_at: new Date().toISOString(),
        });
      } catch (error) {
        return writeError(c, 502, errorMessage(error));
      }
    },

    async testProviderInstance(c: Context): Promise<Response> {
      const req = await readJsonBody<TestProviderRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      let resolved;
      try {
        resolved = await resolveProbeParams({
          instanceId: req.instance_id,
          catalogId: req.catalog_id,
          apiFormat: req.api_format,
          baseUrl: req.base_url,
          apiKey: req.api_key,
        });
      } catch (error) {
        const msg = errorMessage(error);
        return writeError(c, msg.includes("not found") ? 404 : 400, msg);
      }

      if (resolved.apiFormat !== "ollama" && !resolved.apiKey.trim()) {
        return writeJson(c, 200, { status: "error", message: "未设置 API Key" });
      }
      if (!resolved.baseUrl || !isValidHttpUrl(resolved.baseUrl)) {
        return writeJson(c, 200, { status: "error", message: "Base URL 无效或未设置" });
      }

      const client = new Client({
        provider: resolved.apiFormat,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: (req.model_id ?? "").trim() || "probe",
        timeoutMs: DEFAULT_TIMEOUT_MS,
        streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      });
      try {
        await client.probe(c.req.raw.signal);
        return writeJson(c, 200, { status: "ok", message: "连接正常" });
      } catch (error) {
        const msg = errorMessage(error);
        if (msg.includes("authentication error") || msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
          return writeJson(c, 200, { status: "unauthorized", message: msg });
        }
        return writeJson(c, 200, { status: "error", message: msg });
      }
    },

    async checkProviderInstance(c: Context): Promise<Response> {
      try {
        const instance = await ctx.db.getProviderInstance(getID(c));
        if (!instance) return writeError(c, 404, "provider instance not found");
        return writeJson(c, 200, await checkInstance(instance, c.req.raw.signal));
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async checkAllProviderInstances(c: Context): Promise<Response> {
      try {
        const instances = await ctx.db.listProviderInstances();
        const results = [];
        for (const instance of instances) {
          results.push({
            instance_id: instance.id,
            name: instance.name,
            check: await checkInstance(instance, c.req.raw.signal),
          });
        }
        return writeJson(c, 200, { instances: results });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
