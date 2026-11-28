import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SourceStore } from "../interfaces.js";
import type { SourceBlob } from "../types.js";
import { asNumber, asString, asUtcTimestamp, exec, queryOne, queryRows } from "./sql.js";

function scanBlob(row: unknown[]): SourceBlob {
  return {
    id: asString(row[0]),
    document_id: asString(row[1]),
    filename: asString(row[2]),
    media_type: asString(row[3]),
    size: asNumber(row[4]),
    sha256: asString(row[5]),
    created_at: asUtcTimestamp(row[6]),
  };
}

export function sourceBlobsRepo(pool: Pool): SourceStore {
  return {
    async createSourceBlob(blob: SourceBlob, data: Uint8Array): Promise<void> {
      if (!blob) throw new Error("nil source blob");
      if (!blob.id) blob.id = randomUUID();
      const bytes = data ?? new Uint8Array();
      if (!blob.sha256) {
        blob.sha256 = createHash("sha256").update(bytes).digest("hex");
      }
      blob.size = bytes.length;

      const created = await queryOne<[string]>(
        pool,
        `INSERT INTO source_blobs (id, document_id, filename, media_type, size, sha256, bytes)
         VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7)
         ON CONFLICT (sha256) DO NOTHING
         RETURNING created_at`,
        [
          blob.id,
          blob.document_id,
          blob.filename,
          blob.media_type,
          blob.size,
          blob.sha256,
          Buffer.from(bytes),
        ],
      );
      if (created) {
        blob.created_at = asUtcTimestamp(created[0]);
        return;
      }

      const existing = await queryOne(
        pool,
        `SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at
         FROM source_blobs WHERE sha256 = $1`,
        [blob.sha256],
      );
      if (!existing) throw new Error("fetch existing source blob: not found");
      Object.assign(blob, scanBlob(existing));
    },

    async getSourceBlob(id: string) {
      const row = await queryOne(
        pool,
        `SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at, bytes
         FROM source_blobs WHERE id = $1`,
        [id],
      );
      if (!row) return null;
      return { blob: scanBlob(row), data: new Uint8Array(row[7] as Buffer) };
    },

    async getSourceBlobBySHA(sha: string) {
      const row = await queryOne(
        pool,
        `SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at, bytes
         FROM source_blobs WHERE sha256 = $1`,
        [sha],
      );
      if (!row) return null;
      return { blob: scanBlob(row), data: new Uint8Array(row[7] as Buffer) };
    },

    async listSourceBlobs(): Promise<SourceBlob[]> {
      const rows = await queryRows(
        pool,
        `SELECT id, COALESCE(document_id,''), filename, media_type, size, sha256, created_at
         FROM source_blobs ORDER BY created_at ASC, id ASC`,
      );
      return rows.map(scanBlob);
    },

    async deleteSourceBlob(id: string): Promise<void> {
      const affected = await exec(pool, "DELETE FROM source_blobs WHERE id = $1", [id]);
      if (affected === 0) throw new Error(`source blob not found: ${id}`);
    },
  };
}
