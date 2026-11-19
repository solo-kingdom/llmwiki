import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ProviderStore } from "../interfaces.js";
import type { ModelInfo, ProviderInfo, ProviderInstance } from "../types.js";
import { NOW_TEXT, asBoolean, asNumber, asString, exec, queryOne, queryRows, withTransaction } from "./sql.js";

const INSTANCE_COLUMNS = `
  COALESCE(id,''), COALESCE(name,''), COALESCE(catalog_id,''),
  COALESCE(api_key,''), COALESCE(base_url,''),
  COALESCE(created_at,''), COALESCE(updated_at,'')`;

const PROVIDER_COLUMNS = `
  COALESCE(id,''), COALESCE(name,''), COALESCE(api_base,''),
  COALESCE(api_format,'openai'), COALESCE(env_key,''), COALESCE(doc_url,'')`;

function scanInstance(row: unknown[]): ProviderInstance {
  return {
    id: asString(row[0]),
    name: asString(row[1]),
    catalog_id: asString(row[2]),
    api_key: asString(row[3]),
    base_url: asString(row[4]),
    created_at: asString(row[5]),
    updated_at: asString(row[6]),
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
        `INSERT INTO provider_instances (id, name, catalog_id, api_key, base_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT}, ${NOW_TEXT})
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, catalog_id = EXCLUDED.catalog_id,
           api_key = EXCLUDED.api_key, base_url = EXCLUDED.base_url,
           updated_at = EXCLUDED.updated_at
         RETURNING created_at, updated_at`,
        [
          instance.id,
          instance.name.trim(),
          instance.catalog_id,
          instance.api_key,
          instance.base_url,
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

    async updateProviderInstance(
      id: string,
      name: string,
      catalogID: string,
      apiKey: string,
      baseURL: string,
    ): Promise<void> {
      if (name) {
        await exec(
          pool,
          `UPDATE provider_instances SET name = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
          [name.trim(), id],
        );
      }
      if (catalogID) {
        await exec(
          pool,
          `UPDATE provider_instances SET catalog_id = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
          [catalogID, id],
        );
      }
      if (apiKey) {
        await exec(
          pool,
          `UPDATE provider_instances SET api_key = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
          [apiKey, id],
        );
      }
      if (baseURL) {
        await exec(
          pool,
          `UPDATE provider_instances SET base_url = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
          [baseURL, id],
        );
      }
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
            `INSERT INTO provider_info_cache (id, name, api_base, api_format, env_key, doc_url)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              provider.id,
              provider.name,
              provider.api_base,
              provider.api_format,
              provider.env_key,
              provider.doc_url,
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
  };
}
