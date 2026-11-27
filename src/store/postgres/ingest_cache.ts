import type { Pool } from "pg";
import type { CacheEntry } from "../../ingest/types.js";
import type { IngestCacheStore } from "../interfaces.js";
import { asString, queryOne } from "./sql.js";

export function ingestCacheRepo(pool: Pool): IngestCacheStore {
  return {
    async getIngestCacheEntry(cacheKey: string): Promise<CacheEntry | null> {
      const row = await queryOne<[string, string, string]>(
        pool,
        `SELECT source_name, content_sha256, written_files
         FROM ingest_cache
         WHERE cache_key = $1`,
        [cacheKey],
      );
      if (!row) return null;
      const sha256 = asString(row[1]);
      let writtenFiles: string[] = [];
      try {
        const parsed = JSON.parse(asString(row[2]));
        if (Array.isArray(parsed)) {
          writtenFiles = parsed.filter((item): item is string => typeof item === "string");
        }
      } catch {
        writtenFiles = [];
      }
      return {
        source_name: asString(row[0]),
        sha256,
        content_sha256: sha256,
        written_files: writtenFiles,
      };
    },

    async upsertIngestCacheEntry(cacheKey: string, entry: CacheEntry): Promise<void> {
      const sha256 = entry.content_sha256 || entry.sha256;
      const writtenJson = JSON.stringify(entry.written_files ?? []);
      await pool.query(
        `INSERT INTO ingest_cache (cache_key, source_name, content_sha256, written_files)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cache_key) DO UPDATE SET
           source_name = EXCLUDED.source_name,
           content_sha256 = EXCLUDED.content_sha256,
           written_files = EXCLUDED.written_files,
           updated_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
        [cacheKey, entry.source_name ?? "", sha256, writtenJson],
      );
    },

    async deleteIngestCacheEntry(cacheKey: string): Promise<void> {
      await pool.query(`DELETE FROM ingest_cache WHERE cache_key = $1`, [cacheKey]);
    },
  };
}
