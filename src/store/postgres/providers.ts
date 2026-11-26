import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ProviderStore } from "../interfaces.js";
import type { ModelInfo, ProviderInfo, ProviderInstance, ProviderInstanceUpdatePatch } from "../types.js";
import { NOW_TEXT, asBoolean, asNumber, asString, exec, queryOne, queryRows, withTransaction } from "./sql.js";

const INSTANCE_COLUMNS = `
  COALESCE(id,''), COALESCE(name,''), COALESCE(catalog_id,''),
  COALESCE(api_key,''), COALESCE(base_url,''),
  COALESCE(created_at,''), COALESCE(updated_at,''),
  COALESCE(api_format,''), COALESCE(models,'[]')`;

const PROVIDER_COLUMNS = `
  COALESCE(id,''), COALESCE(name,''), COALESCE(api_base,''),
  COALESCE(api_format,'openai'), COALESCE(env_key,''), COALESCE(doc_url,''),
  COALESCE(npm,'')`;

function parseModelsJson(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    return [];
  }
}

function scanInstance(row: unknown[]): ProviderInstance {
  return {
    id: asString(row[0]),
    name: asString(row[1]),
    catalog_id: asString(row[2]),
    api_key: asString(row[3]),
    base_url: asString(row[4]),
    created_at: asString(row[5]),
    updated_at: asString(row[6]),
    api_format: asString(row[7]),
    models: parseModelsJson(asString(row[8])),
  };
}

function scanProvider(row: unknown[]): ProviderInfo {
  return {
    id: asString(row[0]),
    name: asString(row[1]),
    api_base: asString(row[2]),
    api_format: asString(row[3]),
    env_key: asString(row[4]),
    doc_url: asString(row[5]),
    npm: asString(row[6]),
  };
}

function scanModel(row: unknown[]): ModelInfo {
  return {
    provider_id: asString(row[0]),
    model_id: asString(row[1]),
    name: asString(row[2]),
    family: asString(row[3]),
    context_limit: asNumber(row[4]),
    output_limit: asNumber(row[5]),
    cost_input: Number(row[6] ?? 0),
    cost_output: Number(row[7] ?? 0),
    reasoning: asBoolean(row[8]),
    tool_call: asBoolean(row[9]),
    attachment: asBoolean(row[10]),
    modalities: asString(row[11]),
  };
}

export function providersRepo(pool: Pool): ProviderStore {
  return {
    async createProviderInstance(instance: ProviderInstance): Promise<void> {
      if (!instance) throw new Error("nil provider instance");
      if (!instance.id) instance.id = `inst_${randomUUID().slice(0, 8)}`;
      if (!instance.catalog_id) throw new Error("catalog_id is required");
      const row = await queryOne<[string, string]>(
        pool,
        `INSERT INTO provider_instances (id, name, catalog_id, api_format, api_key, base_url, models, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ${NOW_TEXT}, ${NOW_TEXT})
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, catalog_id = EXCLUDED.catalog_id,
           api_format = EXCLUDED.api_format, api_key = EXCLUDED.api_key,
           base_url = EXCLUDED.base_url, models = EXCLUDED.models,
           updated_at = EXCLUDED.updated_at
         RETURNING created_at, updated_at`,
        [
          instance.id,
          instance.name.trim(),
          instance.catalog_id,
          instance.api_format ?? "",
          instance.api_key,
          instance.base_url,
          JSON.stringify(instance.models ?? []),
        ],
      );
      if (!row) throw new Error("create provider instance: no row returned");
      instance.created_at = asString(row[0]);
      instance.updated_at = asString(row[1]);
    },

    async getProviderInstance(id: string): Promise<ProviderInstance | null> {
      const row = await queryOne(
        pool,
        `SELECT ${INSTANCE_COLUMNS} FROM provider_instances WHERE id = $1`,
        [id],
      );
      return row ? scanInstance(row) : null;
    },

    async listProviderInstances(): Promise<ProviderInstance[]> {
      const rows = await queryRows(
        pool,
        `SELECT ${INSTANCE_COLUMNS} FROM provider_instances ORDER BY created_at ASC`,
      );
      return rows.map(scanInstance);
    },

    async updateProviderInstance(id: string, patch: ProviderInstanceUpdatePatch): Promise<void> {
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (patch.name !== undefined) push("name", patch.name.trim());
      if (patch.catalog_id !== undefined) push("catalog_id", patch.catalog_id.trim());
      if (patch.api_format !== undefined) push("api_format", patch.api_format.trim());
      if (patch.api_key !== undefined && patch.api_key.trim() !== "") push("api_key", patch.api_key);
      if (patch.base_url !== undefined) push("base_url", patch.base_url.trim());
      if (patch.models !== undefined) push("models", JSON.stringify(patch.models));
      if (sets.length === 0) return;
      sets.push(`updated_at = ${NOW_TEXT}`);
      params.push(id);
      await exec(
        pool,
        `UPDATE provider_instances SET ${sets.join(", ")} WHERE id = $${params.length}`,
        params,
      );
    },

    async deleteProviderInstance(id: string): Promise<void> {
      const affected = await exec(pool, "DELETE FROM provider_instances WHERE id = $1", [id]);
      if (affected === 0) throw new Error(`provider instance not found: ${id}`);
    },

    async upsertProviderInfo(providers: ProviderInfo[]): Promise<void> {
      await withTransaction(pool, async (client) => {
        await client.query("DELETE FROM provider_info_cache");
        for (const provider of providers) {
          await client.query(
            `INSERT INTO provider_info_cache (id, name, api_base, api_format, env_key, doc_url, npm)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              provider.id,
              provider.name,
              provider.api_base,
              provider.api_format,
              provider.env_key,
              provider.doc_url,
              provider.npm ?? "",
            ],
          );
        }
      });
    },

    async upsertModels(models: ModelInfo[]): Promise<void> {
      await withTransaction(pool, async (client) => {
        const providerIDs = new Set(models.map((model) => model.provider_id));
        for (const providerID of providerIDs) {
          await client.query("DELETE FROM provider_models_cache WHERE provider_id = $1", [
            providerID,
          ]);
        }
        await client.query(
          "DELETE FROM provider_models_cache WHERE provider_id NOT IN (SELECT id FROM provider_info_cache)",
        );
        for (const model of models) {
          await client.query(
            `INSERT INTO provider_models_cache
              (provider_id, model_id, name, family, context_limit, output_limit,
               cost_input, cost_output, reasoning, tool_call, attachment, modalities)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              model.provider_id,
              model.model_id,
              model.name,
              model.family,
              model.context_limit,
              model.output_limit,
              model.cost_input,
              model.cost_output,
              model.reasoning,
              model.tool_call,
              model.attachment,
              model.modalities,
            ],
          );
        }
      });
    },

    async listProviders(): Promise<ProviderInfo[]> {
      const rows = await queryRows(
        pool,
        `SELECT ${PROVIDER_COLUMNS} FROM provider_info_cache ORDER BY name`,
      );
      return rows.map(scanProvider);
    },

    async listModelsByProvider(providerID: string): Promise<ModelInfo[]> {
      const rows = await queryRows(
        pool,
        `SELECT provider_id, model_id, COALESCE(name,''), COALESCE(family,''),
          context_limit, output_limit, cost_input, cost_output,
          reasoning, tool_call, attachment, COALESCE(modalities,'{}')
         FROM provider_models_cache WHERE provider_id = $1 ORDER BY name`,
        [providerID],
      );
      return rows.map(scanModel);
    },

    async getProviderInfo(providerID: string): Promise<ProviderInfo | null> {
      const row = await queryOne(
        pool,
        `SELECT ${PROVIDER_COLUMNS} FROM provider_info_cache WHERE id = $1`,
        [providerID],
      );
      return row ? scanProvider(row) : null;
    },

    async cacheIsEmpty(): Promise<boolean> {
      const row = await queryOne<[number]>(
        pool,
        "SELECT COUNT(*) FROM provider_info_cache",
      );
      return (row ? asNumber(row[0]) : 0) === 0;
    },

    async countCatalog(): Promise<{ provider_count: number; model_count: number }> {
      const row = await queryOne<[number, number]>(
        pool,
        "SELECT (SELECT COUNT(*)::int FROM provider_info_cache), (SELECT COUNT(*)::int FROM provider_models_cache)",
      );
      return {
        provider_count: row ? asNumber(row[0]) : 0,
        model_count: row ? asNumber(row[1]) : 0,
      };
    },
  };
}
