import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IndexStore } from "../interfaces.js";
import type { ReferenceEntryInput, ReferenceEntryView } from "../types.js";
import { asNumber, asString, queryRows } from "./sql.js";

/** Structured reference entries (trailing 相关/来源 sections extracted from
 * wiki content). document_references stays the derived edge table; entries
 * carry annotations and free-text rows with no resolvable target. */
export function referenceEntriesRepo(
  pool: Pool,
): Pick<IndexStore, "replaceReferenceEntriesInTx" | "mergeReferenceEntriesInTx" | "listReferenceEntries"> {
  return {
    async replaceReferenceEntriesInTx(docID: string, entries: ReferenceEntryInput[]): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM document_reference_entries WHERE document_id = $1", [docID]);
        for (const entry of entries) {
          await client.query(
            `INSERT INTO document_reference_entries
               (id, document_id, kind, raw_text, target_document_id, annotation, position)
             VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7)
             ON CONFLICT (document_id, kind, raw_text, annotation) DO NOTHING`,
            [
              randomUUID(),
              docID,
              entry.kind,
              entry.rawText,
              entry.targetDocumentId,
              entry.annotation,
              entry.position,
            ],
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

    async mergeReferenceEntriesInTx(docID: string, entries: ReferenceEntryInput[]): Promise<void> {
      if (entries.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existingRows = await client.query<{
          id: string;
          kind: string;
          raw_text: string;
          target_document_id: string | null;
          annotation: string;
          position: number;
        }>(
          `SELECT id, kind, raw_text, target_document_id, annotation, position
           FROM document_reference_entries
           WHERE document_id = $1`,
          [docID],
        );
        const existingByKey = new Map<string, { id: string; target_document_id: string | null; annotation: string }>();
        let maxPos = -1;
        for (const row of existingRows.rows) {
          const key = `${row.kind}\0${row.raw_text}`;
          if (!existingByKey.has(key)) {
            existingByKey.set(key, {
              id: row.id,
              target_document_id: row.target_document_id,
              annotation: row.annotation,
            });
          }
          if (row.position > maxPos) maxPos = row.position;
        }

        for (const entry of entries) {
          const key = `${entry.kind}\0${entry.rawText}`;
          const prev = existingByKey.get(key);
          if (prev) {
            if (!prev.target_document_id && entry.targetDocumentId) {
              await client.query(
                `UPDATE document_reference_entries SET target_document_id = $2 WHERE id = $1`,
                [prev.id, entry.targetDocumentId],
              );
              prev.target_document_id = entry.targetDocumentId;
            }
            continue;
          }
          maxPos += 1;
          await client.query(
            `INSERT INTO document_reference_entries
               (id, document_id, kind, raw_text, target_document_id, annotation, position)
             VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7)
             ON CONFLICT (document_id, kind, raw_text, annotation) DO NOTHING`,
            [
              randomUUID(),
              docID,
              entry.kind,
              entry.rawText,
              entry.targetDocumentId,
              entry.annotation,
              maxPos,
            ],
          );
          existingByKey.set(key, {
            id: "",
            target_document_id: entry.targetDocumentId || null,
            annotation: entry.annotation,
          });
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async listReferenceEntries(docID: string): Promise<ReferenceEntryView[]> {
      const rows = await queryRows(
        pool,
        `SELECT e.kind, e.raw_text, COALESCE(e.target_document_id, ''), e.annotation, e.position,
                COALESCE(d.title, ''), COALESCE(d.path, ''), COALESCE(d.filename, '')
         FROM document_reference_entries e
         LEFT JOIN documents d ON e.target_document_id = d.id AND COALESCE(d.deleted_at, '') = ''
         WHERE e.document_id = $1
         ORDER BY e.position, e.raw_text`,
        [docID],
      );
      return rows.map((row) => ({
        kind: asString(row[0]) === "source" ? "source" : "related",
        rawText: asString(row[1]),
        targetDocumentId: asString(row[2]),
        annotation: asString(row[3]),
        position: asNumber(row[4]),
        targetTitle: asString(row[5]),
        targetPath: asString(row[6]),
        targetFilename: asString(row[7]),
      }));
    },
  };
}
