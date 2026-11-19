import type { Context } from "hono";
import { Client, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "../llm/client.js";
import { record } from "../activity/index.js";
import type { ProviderInstance } from "../store/types.js";
import {
  getID,
  maskKey,
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

interface ProviderInstanceRequest {
  name?: string;
  catalog_id?: string;
  api_key?: string;
  base_url?: string;
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

export function providersApi(ctx: ApiContext) {
  async function checkInstance(instance: ProviderInstance, signal?: AbortSignal): Promise<ProviderCheckResponse> {
    const response: ProviderCheckResponse = {
      status: "ok",
      message: "连接正常",
      details: {
        has_api_key: Boolean(instance.api_key.trim()),
        has_base_url: Boolean(instance.base_url.trim()),
        reachable: false,
        catalog_id: instance.catalog_id,
      },
    };
    if (!response.details.has_api_key) {
      return { ...response, status: "error", message: "未设置 API Key" };
    }
    let baseUrl = instance.base_url;
    const providerInfo = await ctx.db.getProviderInfo(instance.catalog_id);
    if (providerInfo && !baseUrl) baseUrl = providerInfo.api_base;
    response.details.has_base_url = Boolean(baseUrl.trim());
    if (!response.details.has_base_url) {
      return { ...response, status: "error", message: "未设置 Base URL" };
    }
    const apiFormat = providerInfo?.api_format || "openai";
    const client = new Client({
      provider: apiFormat,
      baseUrl,
      apiKey: instance.api_key,
      model: "probe",
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
        const providers = await ctx.db.listProviders();
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
        const models = await ctx.db.listModelsByProvider(providerId);
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

    async createProviderInstance(c: Context): Promise<Response> {
      const req = await readJsonBody<ProviderInstanceRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      const catalogId = (req.catalog_id ?? "").trim();
      if (!catalogId) return writeError(c, 400, "catalog_id is required");
      try {
        const providerInfo = await ctx.db.getProviderInfo(catalogId);
        if (!providerInfo) return writeError(c, 400, `unknown provider: ${catalogId}`);
        const instance: ProviderInstance = {
          id: "",
          name: (req.name ?? "").trim() || providerInfo.name,
          catalog_id: catalogId,
          api_key: req.api_key ?? "",
          base_url: req.base_url ?? "",
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
          details: { instance_id: instance.id, name: instance.name, catalog_id: instance.catalog_id },
        });
        const response = {
          ...instance,
          api_key: "",
          api_key_masked: maskKey(instance.api_key),
        };
        return writeJson(c, 201, { instance: response });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async listProviderInstances(c: Context): Promise<Response> {
      try {
        const instances = await ctx.db.listProviderInstances();
        return writeJson(c, 200, {
          instances: instances.map((instance) => ({
            ...instance,
            api_key: "",
            api_key_masked: maskKey(instance.api_key),
          })),
        });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getProviderInstance(c: Context): Promise<Response> {
      try {
        const instance = await ctx.db.getProviderInstance(getID(c));
        if (!instance) return writeError(c, 404, "provider instance not found");
        return writeJson(c, 200, {
          instance: { ...instance, api_key: "", api_key_masked: maskKey(instance.api_key) },
        });
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
        if (req.catalog_id && req.catalog_id !== existing.catalog_id) {
          const providerInfo = await ctx.db.getProviderInfo(req.catalog_id.trim());
          if (!providerInfo) return writeError(c, 400, `unknown provider: ${req.catalog_id}`);
        }
        await ctx.db.updateProviderInstance(
          id,
          (req.name ?? "").trim(),
          (req.catalog_id ?? "").trim(),
          req.api_key ?? "",
          req.base_url ?? "",
        );
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
        return writeJson(c, 200, {
          instance: { ...updated, api_key: "", api_key_masked: maskKey(updated.api_key) },
        });
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
