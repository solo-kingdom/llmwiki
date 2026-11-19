import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { wikiPageTypeFromPaths, WIKI_HIDDEN_SUBDIRS } from "../../engine/wiki_org.js";
import type { IndexStore } from "../interfaces.js";
import type { Chunk, SearchChunk } from "../types.js";
import { asNumber, asString, exec, queryRows } from "./sql.js";

function pathFilterClause(pathFilter: string): string {
  if (pathFilter === "wiki") {
    const hidden = [...WIKI_HIDDEN_SUBDIRS]
      .map((subdir) => `d.relative_path LIKE 'wiki/${subdir}/%'`)
      .join(" OR ");
    return `AND d.source_kind = 'wiki' AND NOT (${hidden}) `;
  }
  if (pathFilter === "sources") return "AND d.source_kind != 'wiki' ";
  return "";
}

function scanSearchChunk(row: unknown[]): SearchChunk {
  return {
    document_id: asString(row[0]),
    content: asString(row[1]),
    page: asNumber(row[2]),
    header_breadcrumb: asString(row[3]),
    chunk_index: asNumber(row[4]),
    filename: asString(row[5]),
    title: asString(row[6]),
    path: asString(row[7]),
    file_type: asString(row[8]),
    score: Number(row[9] ?? 0),
  };
}

function mergeSearchResults(primary: SearchChunk[], extra: SearchChunk[], limit: number): SearchChunk[] {
  const seen = new Set<string>();
  const merged: SearchChunk[] = [];
  for (const group of [primary, extra]) {
    for (const item of group) {
      if (seen.has(item.document_id)) continue;
      seen.add(item.document_id);
      merged.push(item);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

function filterByPageType(results: SearchChunk[], pageTypes: string[]): SearchChunk[] {
  if (pageTypes.length === 0) return results;
  const allowed = new Set(pageTypes);
  return results.filter((item) => allowed.has(wikiPageTypeFromPaths("", item.path.replace(/^\/+/, ""))));
}

export function chunksRepo(
  pool: Pool,
): Omit<IndexStore, "listWikiGraphEdges" | "buildKnowledgeGraph"> {
  async function searchFTS(query: string, limit: number, pathFilter: string, pageTypes: string[]) {
    let sql = `
      SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
        d.filename, d.title, d.path, d.file_type,
        (ts_rank_cd(to_tsvector('simple', dc.content), websearch_to_tsquery('simple', $1))
         + similarity(dc.content, $1)) AS score
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
        AND (to_tsvector('simple', dc.content) @@ websearch_to_tsquery('simple', $1)
             OR dc.content ILIKE '%' || $1 || '%') `;
    sql += pathFilterClause(pathFilter);
    sql += "ORDER BY score DESC, dc.chunk_index LIMIT $2";
    const rows = await queryRows(pool, sql, [query, limit]);
    return rows.map(scanSearchChunk);
  }

  async function searchLIKE(query: string, limit: number, pathFilter: string) {
    let sql = `
      SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
        d.filename, d.title, d.path, d.file_type, 0.0 AS score
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE dc.content ILIKE '%' || $1 || '%' AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = '' `;
    sql += pathFilterClause(pathFilter);
    sql += "LIMIT $2";
    const rows = await queryRows(pool, sql, [query, limit]);
    return rows.map(scanSearchChunk);
  }

  async function searchMetadata(query: string, limit: number, pathFilter: string) {
    let sql = `
      SELECT d.id, COALESCE(SUBSTR(d.content, 1, 300), ''), 0, '', 0,
        d.filename, d.title, d.path, d.file_type, 0.0 AS score
      FROM documents d
      WHERE d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
        AND (d.filename ILIKE '%' || $1 || '%'
             OR d.title ILIKE '%' || $1 || '%'
             OR d.path ILIKE '%' || $1 || '%') `;
    sql += pathFilterClause(pathFilter);
    sql += "LIMIT $2";
    const rows = await queryRows(pool, sql, [query, limit]);
    return rows.map(scanSearchChunk);
  }

  return {
    async storeChunks(docID: string, chunks: Chunk[]): Promise<void> {
      await exec(pool, "DELETE FROM document_chunks WHERE document_id = $1", [docID]);
      for (const chunk of chunks) {
        await exec(
          pool,
          `INSERT INTO document_chunks (id, document_id, chunk_index, content, page, start_char, token_count, header_breadcrumb)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            docID,
            chunk.chunk_index,
            chunk.content,
            chunk.page,
            chunk.start_char,
            chunk.token_count,
            chunk.header_breadcrumb,
          ],
        );
      }
    },

    async deleteChunks(docID: string): Promise<void> {
      await exec(pool, "DELETE FROM document_chunks WHERE document_id = $1", [docID]);
    },

    async searchChunks(
      query: string,
      limit: number,
      pathFilter: string,
      pageTypes: string[] = [],
    ): Promise<SearchChunk[]> {
      const trimmed = query.trim();
      if (!trimmed || limit <= 0) return [];

      let ftsError: unknown = null;
      let results: SearchChunk[] = [];
      try {
        results = await searchFTS(trimmed, limit, pathFilter, pageTypes);
      } catch (error) {
        ftsError = error;
      }

      const metadata = await searchMetadata(trimmed, limit, pathFilter);
      results = mergeSearchResults(results, metadata, limit);

      if (results.length === 0) {
        try {
          const like = await searchLIKE(trimmed, limit, pathFilter);
          const likeMeta = await searchMetadata(trimmed, limit, pathFilter);
          results = mergeSearchResults(like, likeMeta, limit);
        } catch (error) {
          if (ftsError) throw ftsError;
          throw error;
        }
      }

      if (results.length === 0 && ftsError) throw ftsError;
      return filterByPageType(results, pageTypes);
    },

    async deleteReferences(sourceDocID: string): Promise<void> {
      await exec(pool, "DELETE FROM document_references WHERE source_document_id = $1", [sourceDocID]);
    },

    async upsertReference(sourceID: string, targetID: string, refType: string, page: number | null): Promise<void> {
      await exec(
        pool,
        `INSERT INTO document_references (id, source_document_id, target_document_id, reference_type, page)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_document_id, target_document_id, reference_type)
         DO UPDATE SET page = EXCLUDED.page`,
        [randomUUID(), sourceID, targetID, refType, page],
      );
    },

    async replaceReferencesInTx(sourceDocID: string, edges): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM document_references WHERE source_document_id = $1", [sourceDocID]);
        for (const edge of edges) {
          await client.query(
            `INSERT INTO document_references (id, source_document_id, target_document_id, reference_type, page)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (source_document_id, target_document_id, reference_type)
             DO UPDATE SET page = EXCLUDED.page`,
            [randomUUID(), edge.source_id, edge.target_id, edge.ref_type, edge.page],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async getBacklinks(docID: string) {
      const rows = await queryRows(
        pool,
        `SELECT d.path, d.filename, d.title, dr.reference_type
         FROM document_references dr
         JOIN documents d ON dr.source_document_id = d.id
         WHERE dr.target_document_id = $1 AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
         ORDER BY d.path, d.filename`,
        [docID],
      );
      return rows.map((row) => ({
        path: asString(row[0]),
        filename: asString(row[1]),
        title: asString(row[2]),
        reference_type: asString(row[3]),
        page: 0,
      }));
    },

    async getForwardReferences(docID: string) {
      const rows = await queryRows(
        pool,
        `SELECT d.filename, d.title, d.path, dr.reference_type, dr.page
         FROM document_references dr
         JOIN documents d ON dr.target_document_id = d.id
         WHERE dr.source_document_id = $1 AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
         ORDER BY dr.reference_type, d.path, d.filename`,
        [docID],
      );
      return rows.map((row) => ({
        filename: asString(row[0]),
        title: asString(row[1]),
        path: asString(row[2]),
        reference_type: asString(row[3]),
        page: asNumber(row[4]),
      }));
    },

    async findUncitedSources() {
      const rows = await queryRows(
        pool,
        `SELECT d.filename, d.title, d.path, d.file_type
         FROM documents d
         WHERE d.source_kind != 'wiki' AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
           AND NOT EXISTS (
             SELECT 1 FROM document_references dr
             WHERE dr.target_document_id = d.id AND dr.reference_type = 'cites'
           )
         ORDER BY d.filename`,
      );
      return rows.map((row) => ({
        filename: asString(row[0]),
        title: asString(row[1]),
        path: asString(row[2]),
        file_type: asString(row[3]),
      }));
    },

    async findStalePages() {
      const rows = await queryRows(
        pool,
        `SELECT d.filename, d.title, d.path, d.stale_since
         FROM documents d
         WHERE d.status != 'failed' AND COALESCE(d.deleted_at, '') = '' AND d.stale_since IS NOT NULL
         ORDER BY d.stale_since DESC`,
      );
      return rows.map((row) => ({
        filename: asString(row[0]),
        title: asString(row[1]),
        path: asString(row[2]),
        stale_since: asString(row[3]),
      }));
    },

    async propagateStaleness(docID: string): Promise<void> {
      await exec(
        pool,
        `UPDATE documents SET stale_since = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
         WHERE id IN (
           SELECT source_document_id FROM document_references
           WHERE target_document_id = $1 AND reference_type = 'links_to'
         ) AND stale_since IS NULL AND COALESCE(deleted_at, '') = ''`,
        [docID],
      );
    },

    async storeChunkEmbeddings(embeddings) {
      if (embeddings.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const item of embeddings) {
          const dim = item.dim > 0 ? item.dim : item.embedding.length;
          await client.query(
            `INSERT INTO chunk_embeddings (chunk_id, model, dim, embedding)
             VALUES ($1, $2, $3, $4::vector)
             ON CONFLICT (chunk_id, model) DO UPDATE
             SET dim = EXCLUDED.dim,
               embedding = EXCLUDED.embedding,
               created_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`,
            [item.chunk_id, item.model, dim, formatVector(item.embedding)],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async searchVector(vector, model, limit, pathFilter, pageTypes = []) {
      if (vector.length === 0 || limit <= 0) return [];
      let sql = `
        SELECT d.id, dc.content, dc.page, dc.header_breadcrumb, dc.chunk_index,
          d.filename, d.title, d.path, d.file_type,
          (1 - (ce.embedding <=> $1::vector)) AS score
        FROM chunk_embeddings ce
        JOIN document_chunks dc ON dc.id = ce.chunk_id
        JOIN documents d ON dc.document_id = d.id
        WHERE ce.model = $2 AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = '' `;
      sql += pathFilterClause(pathFilter);
      sql += "ORDER BY ce.embedding <=> $1::vector LIMIT $3";
      const rows = await queryRows(pool, sql, [formatVector(vector), model, limit]);
      return filterByPageType(rows.map(scanSearchChunk), pageTypes);
    },

    async chunksMissingEmbedding(model, limit) {
      if (limit <= 0) return [];
      const rows = await queryRows(
        pool,
        `SELECT dc.id, dc.document_id, dc.chunk_index, dc.content, dc.page, dc.start_char,
          dc.token_count, dc.header_breadcrumb
         FROM document_chunks dc
         JOIN documents d ON dc.document_id = d.id
         LEFT JOIN chunk_embeddings ce ON ce.chunk_id = dc.id AND ce.model = $1
         WHERE ce.chunk_id IS NULL AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
         ORDER BY dc.document_id, dc.chunk_index
         LIMIT $2`,
        [model, limit],
      );
      return rows.map((row) => ({
        id: asString(row[0]),
        document_id: asString(row[1]),
        chunk_index: asNumber(row[2]),
        content: asString(row[3]),
        page: asNumber(row[4]),
        start_char: asNumber(row[5]),
        token_count: asNumber(row[6]),
        header_breadcrumb: asString(row[7]),
      }));
    },
  };
}

export function formatVector(vector: number[]): string {
  return `[${vector.map((value) => Number(value).toString()).join(",")}]`;
}
