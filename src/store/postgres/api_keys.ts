import type { Pool } from "pg";
import type { ApiKeyStore } from "../interfaces.js";
import type { ApiKeyRecord } from "../types.js";
import { NOW_TEXT, asNumber, asString, exec, queryOne, queryRows } from "./sql.js";

function mapRow(row: unknown[]): ApiKeyRecord {
  return {
    id: asString(row[0]),
    name: asString(row[1]),
    prefix: asString(row[2]),
    created_at: asString(row[3]),
    last_used_at: row[4] == null ? null : asString(row[4]),
  };
}

export function apiKeysRepo(pool: Pool): ApiKeyStore {
  return {
    async createApiKey(input): Promise<ApiKeyRecord> {
      const row = await queryOne<unknown[]>(
        pool,
        `INSERT INTO api_keys (id, name, key_hash, prefix, created_at)
         VALUES ($1, $2, $3, $4, ${NOW_TEXT})
         RETURNING id, name, prefix, created_at, last_used_at`,
        [input.id, input.name, input.key_hash, input.prefix],
      );
      if (!row) throw new Error("failed to create api key");
      return mapRow(row);
    },

    async listApiKeys(): Promise<ApiKeyRecord[]> {
      const rows = await queryRows<unknown[]>(
        pool,
        `SELECT id, name, prefix, created_at, last_used_at
         FROM api_keys
         ORDER BY created_at DESC, id DESC`,
      );
      return rows.map(mapRow);
    },

    async countApiKeys(): Promise<number> {
      const row = await queryOne<unknown[]>(pool, `SELECT COUNT(*)::int FROM api_keys`);
      return row ? asNumber(row[0]) : 0;
    },

    async findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT id, name, prefix, created_at, last_used_at
         FROM api_keys
         WHERE key_hash = $1`,
        [keyHash],
      );
      return row ? mapRow(row) : null;
    },

    async touchApiKey(id: string): Promise<void> {
      await exec(pool, `UPDATE api_keys SET last_used_at = ${NOW_TEXT} WHERE id = $1`, [id]);
    },

    async deleteApiKey(id: string): Promise<boolean> {
      const count = await exec(pool, `DELETE FROM api_keys WHERE id = $1`, [id]);
      return count > 0;
    },
  };
}
