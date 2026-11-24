import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  folderPathFromWikiRelPath,
  resolvePageType,
  wikiPageTypeFromPaths,
  WIKI_HIDDEN_SUBDIRS,
} from "../../engine/wiki_org.js";
import type { DocumentStore } from "../interfaces.js";
import type { Chunk, Document, ListDocumentsFilter } from "../types.js";
import { ensureFolderAncestorsTx } from "./folders.js";
import { NOW_TEXT, asNumber, asString, exec, queryOne, queryRows, withTransaction } from "./sql.js";

const DOCUMENT_SELECT = `
  COALESCE(d.id, ''), COALESCE(d.user_id, ''), COALESCE(d.filename, ''),
  COALESCE(d.title, ''), COALESCE(d.path, ''), COALESCE(d.relative_path, ''),
  COALESCE(d.source_kind, ''), COALESCE(d.file_type, ''), COALESCE(d.file_size, 0),
  COALESCE(d.document_number, 0), COALESCE(d.status, ''), COALESCE(d.page_count, 0),
  COALESCE(d.content, ''), COALESCE(d.tags, '[]'), COALESCE(d.date, ''),
  COALESCE(d.metadata, ''), COALESCE(d.error_message, ''), COALESCE(d.version, 0),
  COALESCE(d.parser, ''), COALESCE(d.content_hash, ''), COALESCE(d.stale_since, ''),
  COALESCE(d.highlights, '[]'), COALESCE(d.created_at, ''), COALESCE(d.updated_at, ''),
  COALESCE(d.deleted_at, ''), COALESCE(d.page_type, '')`;

function scanDocument(row: unknown[]): Document {
  const tagsRaw = asString(row[13]);
  const relPath = asString(row[5]);
  const filePath = asString(row[4]);
  const storedPageType = asString(row[25]);
  return {
    id: asString(row[0]),
    user_id: asString(row[1]),
    filename: asString(row[2]),
    title: asString(row[3]),
    path: filePath,
    relative_path: relPath,
    source_kind: asString(row[6]),
    file_type: asString(row[7]),
    file_size: asNumber(row[8]),
    document_number: asNumber(row[9]),
    status: asString(row[10]),
    page_count: asNumber(row[11]),
    content: asString(row[12]),
    tags: parseTags(tagsRaw),
    date: asString(row[14]),
    metadata: asString(row[15]),
    error_message: asString(row[16]),
    version: asNumber(row[17]),
    parser: asString(row[18]),
    content_hash: asString(row[19]),
    stale_since: asString(row[20]),
    highlights: asString(row[21]),
    created_at: asString(row[22]),
    updated_at: asString(row[23]),
    deleted_at: asString(row[24]),
    page_type: storedPageType || wikiPageTypeFromPaths(relPath, filePath),
  };
}

function parseTags(raw: string): string[] {
  if (!raw || raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function tagsJson(tags: string[]): string {
  return tags.length > 0 ? JSON.stringify(tags) : "[]";
}

export function hiddenSubdirsWhere(column: string): string {
  return [...WIKI_HIDDEN_SUBDIRS]
    .map((subdir) => `${column} LIKE 'wiki/${subdir}/%'`)
    .join(" OR ");
}

export function documentsRepo(pool: Pool): DocumentStore {
  return {
    async createDocument(doc: Document): Promise<void> {
      const id = doc.id || randomUUID();
      const tags = tagsJson(doc.tags);
      const pageType =
        doc.source_kind === "wiki"
          ? resolvePageType("", doc.page_type ?? "", doc.relative_path)
          : (doc.page_type ?? "");
      await withTransaction(pool, async (client) => {
        const row = await queryOne<[number]>(client, "SELECT COALESCE(MAX(document_number), 0) + 1 FROM documents");
        const documentNumber = row ? asNumber(row[0]) : 1;
        await exec(
          client,
          `INSERT INTO documents (
            id, user_id, filename, title, path, relative_path, source_kind,
            file_type, file_size, document_number, status, content, tags, date,
            metadata, version, parser, content_hash, highlights, page_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            id,
            doc.user_id,
            doc.filename,
            doc.title,
            doc.path,
            doc.relative_path,
            doc.source_kind,
            doc.file_type,
            doc.file_size,
            documentNumber,
            doc.status,
            doc.content,
            tags,
            doc.date,
            doc.metadata,
            doc.version,
            doc.parser,
            doc.content_hash,
            doc.highlights,
            pageType,
          ],
        );
        if (doc.source_kind === "wiki") {
          const folder = folderPathFromWikiRelPath(doc.relative_path);
          if (folder) await ensureFolderAncestorsTx(client, folder);
        }
        doc.id = id;
        doc.document_number = documentNumber;
        doc.page_type = pageType;
      });
    },

    async getDocument(id: string): Promise<Document | null> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT ${DOCUMENT_SELECT} FROM documents d WHERE d.id = $1 AND d.status != 'failed'`,
        [id],
      );
      return row ? scanDocument(row) : null;
    },

    async getWikiDocumentByID(id: string): Promise<Document | null> {
      const doc = await this.getDocument(id);
      if (!doc || doc.source_kind !== "wiki" || doc.status === "failed") return null;
      return doc;
    },

    async findDocumentByName(name: string): Promise<Document | null> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT ${DOCUMENT_SELECT} FROM documents d
         WHERE (lower(d.filename) = lower($1) OR lower(d.title) = lower($1))
           AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
         LIMIT 1`,
        [name],
      );
      return row ? scanDocument(row) : null;
    },

    async getDocumentByRelativePath(relativePath: string): Promise<Document | null> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT ${DOCUMENT_SELECT} FROM documents d
         WHERE d.relative_path = $1 AND COALESCE(d.deleted_at, '') = ''
         LIMIT 1`,
        [relativePath],
      );
      return row ? scanDocument(row) : null;
    },

    async getDocumentByPath(filename: string, dirPath: string): Promise<Document | null> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT ${DOCUMENT_SELECT} FROM documents d
         WHERE d.filename = $1 AND d.path = $2 AND d.status != 'failed' AND COALESCE(d.deleted_at, '') = ''
         LIMIT 1`,
        [filename, dirPath],
      );
      return row ? scanDocument(row) : null;
    },

    async updateDocument(
      id: string,
      content: string,
      title: string,
      tags: string[],
      date: string,
      metadata: string,
    ): Promise<void> {
      await exec(
        pool,
        `UPDATE documents SET
          content = $1,
          title = COALESCE(NULLIF($2, ''), title),
          tags = $3,
          date = COALESCE(NULLIF($4, ''), date),
          metadata = COALESCE(NULLIF($5, ''), metadata),
          version = COALESCE(version, 0) + 1,
          updated_at = ${NOW_TEXT}
        WHERE id = $6`,
        [content, title, tagsJson(tags), date, metadata, id],
      );
    },

    async archiveDocuments(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      return withTransaction(pool, async (client) => {
        const archived = await exec(
          client,
          `UPDATE documents SET deleted_at = ${NOW_TEXT}
           WHERE id = ANY($1::text[]) AND COALESCE(deleted_at, '') = ''`,
          [ids],
        );
        await exec(client, "DELETE FROM document_chunks WHERE document_id = ANY($1::text[])", [ids]);
        await exec(
          client,
          `DELETE FROM document_references
           WHERE source_document_id = ANY($1::text[]) OR target_document_id = ANY($1::text[])`,
          [ids],
        );
        return archived;
      });
    },

    async listDocuments(): Promise<Document[]> {
      return this.listDocumentsFiltered({});
    },

    async listDocumentsFiltered(filter: ListDocumentsFilter): Promise<Document[]> {
      let sql = `
        SELECT id, filename, title, path, file_type, COALESCE(page_count, 0), COALESCE(updated_at, ''),
          COALESCE(relative_path, ''), COALESCE(source_kind, ''), COALESCE(page_type, '')
        FROM documents WHERE status != 'failed' AND COALESCE(deleted_at, '') = '' `;
      const args: unknown[] = [];
      if (filter.source_kind) {
        args.push(filter.source_kind);
        sql += `AND source_kind = $${args.length} `;
      }
      if (filter.exclude_hidden) {
        sql += `AND NOT (${hiddenSubdirsWhere("relative_path")}) `;
      }
      sql += "ORDER BY path, filename";

      const rows = await queryRows(pool, sql, args);
      const docs: Document[] = [];
      for (const row of rows) {
        const storedType = asString(row[9]);
        const doc: Document = {
          id: asString(row[0]),
          filename: asString(row[1]),
          title: asString(row[2]),
          path: asString(row[3]),
          file_type: asString(row[4]),
          page_count: asNumber(row[5]),
          updated_at: asString(row[6]),
          relative_path: asString(row[7]),
          source_kind: asString(row[8]),
          user_id: "",
          document_number: 0,
          file_size: 0,
          status: "",
          content: "",
          tags: [],
          date: "",
          metadata: "",
          error_message: "",
          version: 0,
          parser: "",
          content_hash: "",
          stale_since: "",
          highlights: "",
          created_at: "",
        };
        doc.page_type = storedType || wikiPageTypeFromPaths(doc.relative_path, doc.path);
        if (filter.page_types?.length && !filter.page_types.includes(doc.page_type)) continue;
        docs.push(doc);
      }
      return docs;
    },

    async listDocumentsWithContent(): Promise<Document[]> {
      const rows = await queryRows(
        pool,
        `SELECT id, filename, title, path, content, file_type,
          COALESCE(page_count, 0), COALESCE(status, ''), COALESCE(source_kind, ''),
          COALESCE(relative_path, ''), COALESCE(tags, '[]'), COALESCE(date, ''),
          COALESCE(metadata, ''), COALESCE(stale_since, ''), COALESCE(highlights, '[]'),
          COALESCE(version, 0), COALESCE(page_type, '')
        FROM documents WHERE status != 'failed' AND COALESCE(deleted_at, '') = '' ORDER BY path, filename`,
      );
      return rows.map((row) => {
        const pathVal = asString(row[3]);
        const relPath = asString(row[9]);
        const storedType = asString(row[16]);
        return {
          id: asString(row[0]),
          filename: asString(row[1]),
          title: asString(row[2]),
          path: pathVal,
          content: asString(row[4]),
          file_type: asString(row[5]),
          page_count: asNumber(row[6]),
          status: asString(row[7]),
          source_kind: asString(row[8]),
          relative_path: relPath,
          tags: parseTags(asString(row[10])),
          date: asString(row[11]),
          metadata: asString(row[12]),
          stale_since: asString(row[13]),
          highlights: asString(row[14]),
          version: asNumber(row[15]),
          page_type: storedType || wikiPageTypeFromPaths(relPath, pathVal),
          user_id: "",
          document_number: 0,
          file_size: 0,
          error_message: "",
          parser: "",
          content_hash: "",
          created_at: "",
          updated_at: "",
        };
      });
    },
  };
}
