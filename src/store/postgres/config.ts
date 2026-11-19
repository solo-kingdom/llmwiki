import type { Pool } from "pg";
import type { ConfigStore } from "../interfaces.js";
import { DEFAULT_MAX_CONCURRENT_JOBS } from "../types.js";
import { NOW_TEXT, asString, exec, queryOne, queryRows } from "./sql.js";

export function configRepo(pool: Pool): ConfigStore {
  return {
    async getConfig(key: string): Promise<string> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT COALESCE(value, '') FROM app_config WHERE key = $1`,
        [key],
      );
      return row ? asString(row[0]) : "";
    },

    async setConfig(key: string, value: string): Promise<void> {
      await exec(
        pool,
        `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, ${NOW_TEXT})
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = ${NOW_TEXT}`,
        [key, value],
      );
    },

    async getAllConfig(): Promise<Record<string, string>> {
      const rows = await queryRows(pool, "SELECT key, value FROM app_config");
      const config: Record<string, string> = {};
      for (const row of rows) {
        config[asString(row[0])] = asString(row[1]);
      }
      return config;
    },

    async maxConcurrentJobs(): Promise<number> {
      const value = await this.getConfig("job_max_concurrent");
      if (!value) return DEFAULT_MAX_CONCURRENT_JOBS;
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT_JOBS;
      return parsed;
    },

    async parallelEnabled(): Promise<boolean> {
      const value = await this.getConfig("job_parallel_enabled");
      return value === "true" || value === "1";
    },
  };
}
