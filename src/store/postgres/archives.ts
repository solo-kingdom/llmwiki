import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import type { ArchiveStore } from "../interfaces.js";
import type {
  ArchiveFile,
  ArchiveFileKind,
  ArchiveFileOrigin,
  ArchiveFolder,
  ArchiveFolderWithCounts,
  ArchiveLinkedDocument,
  ArchiveSourceSummary,
  ArchiveStorageBackend,
  DeleteArchiveFolderResult,
  FolderDeleteMode,
  MoveArchiveFolderResult,
} from "../types.js";
import { NOW_TEXT, asNumber, asString, exec, queryOne, queryRows, withTransaction } from "./sql.js";

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

export class ArchiveNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveNotFoundError";
  }
}

export class ArchiveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveConflictError";
  }
}

export function normalizeArchiveFolderPath(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  if (!cleaned) return "";
  const parts = cleaned.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || /[\x00-\x1f\x7f]/.test(part)) {
      throw new ArchiveValidationError(`invalid folder path segment: ${part}`);
    }
  }
  return parts.join("/");
}

export function validateArchiveFolderPath(raw: string): string {
  const normalized = normalizeArchiveFolderPath(raw);
  if (!normalized) throw new ArchiveValidationError("folder path cannot be empty");
  return normalized;
}

export function validateArchiveFilename(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ArchiveValidationError("filename cannot be empty");
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\") || /[\x00-\x1f\x7f]/.test(name)) {
    throw new ArchiveValidationError(`invalid filename: ${name}`);
  }
  if (name.length > 255) throw new ArchiveValidationError("filename too long");
  return name;
}

export function buildArchiveRelativePath(folderPath: string, filename: string): string {
  const normFolder = normalizeArchiveFolderPath(folderPath);
  const normFile = validateArchiveFilename(filename);
  return normFolder ? `${normFolder}/${normFile}` : normFile;
}

export function ancestorArchiveFolderPaths(folderPath: string): string[] {
  const norm = normalizeArchiveFolderPath(folderPath);
  if (!norm) return [];
  const parts = norm.split("/");
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i += 1) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

function parentFolderOf(folderPath: string): string {
  const idx = folderPath.lastIndexOf("/");
  return idx < 0 ? "" : folderPath.slice(0, idx);
}

function isPgUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

const ARCHIVE_FILE_COLUMNS = `
  id, folder_path, filename, relative_path, media_type, kind, size, sha256,
  storage_backend, storage_key, origin, source_ref, ingest_job_id, created_at, updated_at`;

function scanFolder(row: unknown[]): ArchiveFolder {
  return {
    path: asString(row[0]),
    display_name: asString(row[1]),
    description: asString(row[2]),
    sort_order: asNumber(row[3]),
    created_at: asString(row[4]),
    updated_at: asString(row[5]),
  };
}

function scanArchiveFile(row: unknown[]): ArchiveFile {
  return {
    id: asString(row[0]),
    folder_path: asString(row[1]),
    filename: asString(row[2]),
    relative_path: asString(row[3]),
    media_type: asString(row[4]),
    kind: asString(row[5]) as ArchiveFileKind,
    size: asNumber(row[6]),
    sha256: asString(row[7]),
    storage_backend: asString(row[8]) as ArchiveStorageBackend,
    storage_key: asString(row[9]),
    origin: asString(row[10]) as ArchiveFileOrigin,
    source_ref: asString(row[11]),
    ingest_job_id: asString(row[12]),
    created_at: asString(row[13]),
    updated_at: asString(row[14]),
  };
}

async function ensureArchiveFoldersTx(client: PoolClient, folderPaths: string[]): Promise<void> {
  const all = new Set<string>();
  for (const raw of folderPaths) {
    const norm = normalizeArchiveFolderPath(raw);
    if (!norm) continue;
    for (const anc of ancestorArchiveFolderPaths(norm)) all.add(anc);
  }
  const sorted = [...all].sort((a, b) => a.length - b.length);
  for (const folder of sorted) {
    const baseName = path.posix.basename(folder);
    await client.query(
      `INSERT INTO archive_folders (path, display_name)
       VALUES ($1, $2)
       ON CONFLICT (path) DO NOTHING`,
      [folder, baseName],
    );
  }
}

export function archivesRepo(pool: Pool): ArchiveStore {
  return {
    async listArchiveFolders(): Promise<ArchiveFolderWithCounts[]> {
      const rows = await queryRows(
        pool,
        `SELECT f.path, f.display_name, f.description, f.sort_order, f.created_at, f.updated_at,
          (SELECT COUNT(*)::int FROM archive_files af WHERE af.folder_path = f.path) AS direct_count,
          (SELECT COUNT(*)::int FROM archive_files af WHERE af.folder_path = f.path OR af.folder_path LIKE f.path || '/%') AS total_count
         FROM archive_folders f
         ORDER BY f.sort_order ASC, f.path ASC`,
      );
      return rows.map((row) => ({
        ...scanFolder(row),
        direct_count: asNumber(row[6]),
        total_count: asNumber(row[7]),
      }));
    },

    async getArchiveFolder(folderPath: string): Promise<ArchiveFolder | null> {
      const norm = normalizeArchiveFolderPath(folderPath);
      if (!norm) return null;
      const row = await queryOne(
        pool,
        `SELECT path, display_name, description, sort_order, created_at, updated_at
         FROM archive_folders WHERE path = $1`,
        [norm],
      );
      return row ? scanFolder(row) : null;
    },

    async ensureArchiveFolders(folderPaths: string[]): Promise<void> {
      await withTransaction(pool, async (client) => {
        await ensureArchiveFoldersTx(client, folderPaths);
      });
    },

    async createArchiveFolder(input): Promise<ArchiveFolder> {
      const folderPath = validateArchiveFolderPath(input.path);
      return withTransaction(pool, async (client) => {
        const existing = await queryOne(client, `SELECT path FROM archive_folders WHERE path = $1`, [folderPath]);
        if (existing) throw new ArchiveConflictError(`folder already exists: ${folderPath}`);
        const parent = parentFolderOf(folderPath);
        if (parent) await ensureArchiveFoldersTx(client, [parent]);
        const displayName = (input.display_name ?? "").trim() || path.posix.basename(folderPath);
        const row = await queryOne(
          client,
          `INSERT INTO archive_folders (path, display_name, description, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, ${NOW_TEXT}, ${NOW_TEXT})
           RETURNING path, display_name, description, sort_order, created_at, updated_at`,
          [folderPath, displayName, (input.description ?? "").trim(), input.sort_order ?? 0],
        );
        if (!row) throw new Error("create archive folder failed");
        return scanFolder(row);
      });
    },

    async updateArchiveFolder(folderPath, patch): Promise<ArchiveFolder | null> {
      const norm = validateArchiveFolderPath(folderPath);
      const existing = await this.getArchiveFolder(norm);
      if (!existing) return null;
      const displayName = patch.display_name !== undefined ? patch.display_name.trim() : existing.display_name;
      const description = patch.description !== undefined ? patch.description.trim() : existing.description;
      const sortOrder = patch.sort_order !== undefined ? patch.sort_order : existing.sort_order;
      const row = await queryOne(
        pool,
        `UPDATE archive_folders
         SET display_name = $2, description = $3, sort_order = $4, updated_at = ${NOW_TEXT}
         WHERE path = $1
         RETURNING path, display_name, description, sort_order, created_at, updated_at`,
        [norm, displayName, description, sortOrder],
      );
      return row ? scanFolder(row) : null;
    },

    async moveArchiveFolder(fromPathRaw: string, toPathRaw: string): Promise<MoveArchiveFolderResult> {
      const fromPath = validateArchiveFolderPath(fromPathRaw);
      const toPath = validateArchiveFolderPath(toPathRaw);
      if (fromPath === toPath) {
        return { from_path: fromPath, to_path: toPath, moved_folders: 0, moved_files: 0 };
      }
      if (toPath.startsWith(`${fromPath}/`)) {
        throw new ArchiveValidationError("cannot move a folder into its own subfolder");
      }

      return withTransaction(pool, async (client) => {
        const src = await queryOne(client, `SELECT path FROM archive_folders WHERE path = $1 FOR UPDATE`, [fromPath]);
        if (!src) throw new ArchiveNotFoundError(`folder not found: ${fromPath}`);

        const conflict = await queryOne(
          client,
          `SELECT path FROM archive_folders WHERE path = $1 OR path LIKE $2 LIMIT 1`,
          [toPath, `${toPath}/%`],
        );
        if (conflict) throw new ArchiveConflictError(`target folder already exists: ${toPath}`);

        const parent = parentFolderOf(toPath);
        if (parent) await ensureArchiveFoldersTx(client, [parent]);

        const subFolders = await queryRows<[string]>(
          client,
          `SELECT path FROM archive_folders WHERE path = $1 OR path LIKE $2 ORDER BY length(path) ASC`,
          [fromPath, `${fromPath}/%`],
        );
        for (const [oldFolder] of subFolders) {
          const suffix = oldFolder.slice(fromPath.length);
          const nextFolder = `${toPath}${suffix}`;
          await client.query(
            `UPDATE archive_folders SET path = $2, updated_at = ${NOW_TEXT} WHERE path = $1`,
            [oldFolder, nextFolder],
          );
        }

        const files = await queryRows<[string, string, string]>(
          client,
          `SELECT id, folder_path, filename FROM archive_files
           WHERE folder_path = $1 OR folder_path LIKE $2 FOR UPDATE`,
          [fromPath, `${fromPath}/%`],
        );
        for (const [fileId, oldFolder, filename] of files) {
          const suffix = oldFolder.slice(fromPath.length);
          const nextFolder = `${toPath}${suffix}`;
          const nextRel = buildArchiveRelativePath(nextFolder, filename);
          try {
            await client.query(
              `UPDATE archive_files
               SET folder_path = $2, relative_path = $3, updated_at = ${NOW_TEXT}
               WHERE id = $1`,
              [fileId, nextFolder, nextRel],
            );
          } catch (error) {
            if (isPgUniqueViolation(error)) {
              throw new ArchiveConflictError(`target file path conflict: ${nextRel}`);
            }
            throw error;
          }
        }

        return {
          from_path: fromPath,
          to_path: toPath,
          moved_folders: subFolders.length,
          moved_files: files.length,
        };
      });
    },

    async deleteArchiveFolder(
      folderPathRaw: string,
      mode: FolderDeleteMode,
      targetFolderRaw?: string,
    ): Promise<DeleteArchiveFolderResult> {
      const folderPath = validateArchiveFolderPath(folderPathRaw);
      const fallbackParent = parentFolderOf(folderPath);
      const targetFolder =
        targetFolderRaw !== undefined ? normalizeArchiveFolderPath(targetFolderRaw) : fallbackParent;

      return withTransaction(pool, async (client) => {
        const exists = await queryOne(client, `SELECT path FROM archive_folders WHERE path = $1 FOR UPDATE`, [
          folderPath,
        ]);
        if (!exists) throw new ArchiveNotFoundError(`folder not found: ${folderPath}`);

        const subFolders = await queryRows<[string]>(
          client,
          `SELECT path FROM archive_folders WHERE path = $1 OR path LIKE $2`,
          [folderPath, `${folderPath}/%`],
        );
        const files = await queryRows<[string, string, string, string]>(
          client,
          `SELECT id, filename, storage_backend, storage_key FROM archive_files
           WHERE folder_path = $1 OR folder_path LIKE $2 FOR UPDATE`,
          [folderPath, `${folderPath}/%`],
        );

        if (mode === "empty") {
          if (subFolders.length > 1 || files.length > 0) {
            throw new ArchiveConflictError("folder is not empty");
          }
          await client.query(`DELETE FROM archive_folders WHERE path = $1`, [folderPath]);
          return {
            path: folderPath,
            mode,
            deleted_folders: 1,
            moved_files: 0,
            deleted_files: 0,
            removed_storage_refs: [],
          };
        }

        if (mode === "move_to_parent") {
          if (targetFolder === folderPath || targetFolder.startsWith(`${folderPath}/`)) {
            throw new ArchiveValidationError("target_folder cannot be inside the deleted folder");
          }
          if (targetFolder) await ensureArchiveFoldersTx(client, [targetFolder]);
          for (const [fileId, filename] of files) {
            const nextRel = buildArchiveRelativePath(targetFolder, filename);
            try {
              await client.query(
                `UPDATE archive_files
                 SET folder_path = $2, relative_path = $3, updated_at = ${NOW_TEXT}
                 WHERE id = $1`,
                [fileId, targetFolder, nextRel],
              );
            } catch (error) {
              if (isPgUniqueViolation(error)) {
                throw new ArchiveConflictError(`file already exists at target: ${nextRel}`);
              }
              throw error;
            }
          }
          const deletedFolders = await exec(
            client,
            `DELETE FROM archive_folders WHERE path = $1 OR path LIKE $2`,
            [folderPath, `${folderPath}/%`],
          );
          return {
            path: folderPath,
            mode,
            deleted_folders: deletedFolders,
            moved_files: files.length,
            deleted_files: 0,
            removed_storage_refs: [],
          };
        }

        // cascade
        const removedRefs: Array<{ storage_backend: ArchiveStorageBackend; storage_key: string }> = [];
        for (const [, , backend, key] of files) {
          if ((backend === "local" || backend === "s3") && key) {
            removedRefs.push({ storage_backend: backend, storage_key: key });
          }
        }
        const deletedFiles = await exec(
          client,
          `DELETE FROM archive_files WHERE folder_path = $1 OR folder_path LIKE $2`,
          [folderPath, `${folderPath}/%`],
        );
        const deletedFolders = await exec(
          client,
          `DELETE FROM archive_folders WHERE path = $1 OR path LIKE $2`,
          [folderPath, `${folderPath}/%`],
        );
        return {
          path: folderPath,
          mode,
          deleted_folders: deletedFolders,
          moved_files: 0,
          deleted_files: deletedFiles,
          removed_storage_refs: removedRefs,
        };
      });
    },

    async listArchiveFiles(filter = {}): Promise<ArchiveFile[]> {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.folder_path !== undefined && filter.folder_path !== "") {
        const norm = normalizeArchiveFolderPath(filter.folder_path);
        params.push(norm, `${norm}/%`);
        clauses.push(`(folder_path = $${params.length - 1} OR folder_path LIKE $${params.length})`);
      }
      if (filter.kind && filter.kind.trim()) {
        params.push(filter.kind.trim().toLowerCase());
        clauses.push(`kind = $${params.length}`);
      }
      if (filter.q && filter.q.trim()) {
        params.push(`%${filter.q.trim()}%`);
        clauses.push(`(filename ILIKE $${params.length} OR relative_path ILIKE $${params.length})`);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await queryRows(
        pool,
        `SELECT ${ARCHIVE_FILE_COLUMNS} FROM archive_files ${where} ORDER BY folder_path ASC, filename ASC`,
        params,
      );
      return rows.map(scanArchiveFile);
    },

    async getArchiveFile(id: string): Promise<ArchiveFile | null> {
      const row = await queryOne(
        pool,
        `SELECT ${ARCHIVE_FILE_COLUMNS} FROM archive_files WHERE id = $1`,
        [id],
      );
      return row ? scanArchiveFile(row) : null;
    },

    async getArchiveFileByRelativePath(relativePath: string): Promise<ArchiveFile | null> {
      const cleaned = relativePath.trim().replace(/^\/+/, "");
      if (!cleaned) return null;
      const row = await queryOne(
        pool,
        `SELECT ${ARCHIVE_FILE_COLUMNS} FROM archive_files WHERE relative_path = $1`,
        [cleaned],
      );
      return row ? scanArchiveFile(row) : null;
    },

    async getArchiveFileInlineBytes(id: string): Promise<Uint8Array | null> {
      const row = await queryOne<[Buffer | null]>(
        pool,
        `SELECT inline_bytes FROM archive_files WHERE id = $1`,
        [id],
      );
      if (!row || !row[0]) return null;
      return new Uint8Array(row[0]);
    },

    async createArchiveFile(file: ArchiveFile, inlineBytes: Uint8Array | null): Promise<ArchiveFile> {
      const folderPath = normalizeArchiveFolderPath(file.folder_path);
      const filename = validateArchiveFilename(file.filename);
      const relPath = buildArchiveRelativePath(folderPath, filename);
      const id = file.id || randomUUID();

      return withTransaction(pool, async (client) => {
        if (folderPath) await ensureArchiveFoldersTx(client, [folderPath]);
        try {
          const row = await queryOne(
            client,
            `INSERT INTO archive_files (
              id, folder_path, filename, relative_path, media_type, kind, size, sha256,
              storage_backend, storage_key, inline_bytes, origin, source_ref, ingest_job_id,
              created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,${NOW_TEXT},${NOW_TEXT})
            RETURNING ${ARCHIVE_FILE_COLUMNS}`,
            [
              id,
              folderPath,
              filename,
              relPath,
              file.media_type,
              file.kind,
              file.size,
              file.sha256,
              file.storage_backend,
              file.storage_key,
              inlineBytes ? Buffer.from(inlineBytes) : null,
              file.origin,
              file.source_ref,
              file.ingest_job_id,
            ],
          );
          if (!row) throw new Error("create archive file failed");
          return scanArchiveFile(row);
        } catch (error) {
          if (isPgUniqueViolation(error)) {
            throw new ArchiveConflictError(`archive file already exists: ${relPath}`);
          }
          throw error;
        }
      });
    },

    async updateArchiveFileLocation(id: string, folderPathRaw: string, filenameRaw: string): Promise<ArchiveFile> {
      const folderPath = normalizeArchiveFolderPath(folderPathRaw);
      const filename = validateArchiveFilename(filenameRaw);
      const relPath = buildArchiveRelativePath(folderPath, filename);

      return withTransaction(pool, async (client) => {
        const existing = await queryOne(client, `SELECT id FROM archive_files WHERE id = $1 FOR UPDATE`, [id]);
        if (!existing) throw new ArchiveNotFoundError(`archive file not found: ${id}`);
        if (folderPath) await ensureArchiveFoldersTx(client, [folderPath]);
        try {
          const row = await queryOne(
            client,
            `UPDATE archive_files
             SET folder_path = $2, filename = $3, relative_path = $4, updated_at = ${NOW_TEXT}
             WHERE id = $1
             RETURNING ${ARCHIVE_FILE_COLUMNS}`,
            [id, folderPath, filename, relPath],
          );
          if (!row) throw new ArchiveNotFoundError(`archive file not found: ${id}`);
          return scanArchiveFile(row);
        } catch (error) {
          if (isPgUniqueViolation(error)) {
            throw new ArchiveConflictError(`archive file already exists: ${relPath}`);
          }
          throw error;
        }
      });
    },

    async updateArchiveFileContentMeta(id, patch): Promise<ArchiveFile> {
      const existing = await this.getArchiveFile(id);
      if (!existing) throw new ArchiveNotFoundError(`archive file not found: ${id}`);
      const row = await queryOne(
        pool,
        `UPDATE archive_files
         SET size = $2,
             sha256 = $3,
             storage_backend = $4,
             storage_key = $5,
             inline_bytes = $6,
             media_type = COALESCE($7, media_type),
             kind = COALESCE($8, kind),
             updated_at = ${NOW_TEXT}
         WHERE id = $1
         RETURNING ${ARCHIVE_FILE_COLUMNS}`,
        [
          id,
          patch.size,
          patch.sha256,
          patch.storage_backend,
          patch.storage_key,
          patch.inline_bytes ? Buffer.from(patch.inline_bytes) : null,
          patch.media_type ?? null,
          patch.kind ?? null,
        ],
      );
      if (!row) throw new ArchiveNotFoundError(`archive file not found: ${id}`);
      return scanArchiveFile(row);
    },

    async deleteArchiveFile(id: string): Promise<ArchiveFile | null> {
      const existing = await this.getArchiveFile(id);
      if (!existing) return null;
      await exec(pool, `DELETE FROM archive_files WHERE id = $1`, [id]);
      return existing;
    },

    async linkDocumentArchiveSource(
      documentId: string,
      archiveFileId: string,
      changeSetId = "",
      relation = "ingest_source",
    ): Promise<void> {
      await pool.query(
        `INSERT INTO document_archive_sources (document_id, archive_file_id, change_set_id, relation, created_at)
         VALUES ($1, $2, $3, $4, ${NOW_TEXT})
         ON CONFLICT (document_id, archive_file_id)
         DO UPDATE SET change_set_id = EXCLUDED.change_set_id, relation = EXCLUDED.relation`,
        [documentId, archiveFileId, changeSetId, relation],
      );
    },

    async listDocumentArchiveSources(documentId: string): Promise<ArchiveSourceSummary[]> {
      const rows = await queryRows(
        pool,
        `SELECT af.id, af.filename, af.folder_path, af.relative_path, af.kind, af.media_type,
                af.size, af.origin, das.relation, das.created_at
         FROM document_archive_sources das
         JOIN archive_files af ON af.id = das.archive_file_id
         WHERE das.document_id = $1
         ORDER BY das.created_at DESC, af.filename ASC`,
        [documentId],
      );
      return rows.map((row) => ({
        id: asString(row[0]),
        filename: asString(row[1]),
        folder_path: asString(row[2]),
        relative_path: asString(row[3]),
        kind: asString(row[4]) as ArchiveFileKind,
        media_type: asString(row[5]),
        size: asNumber(row[6]),
        origin: asString(row[7]) as ArchiveFileOrigin,
        relation: asString(row[8]),
        created_at: asString(row[9]),
      }));
    },

    async listArchiveFileDocuments(archiveFileId: string): Promise<ArchiveLinkedDocument[]> {
      const rows = await queryRows(
        pool,
        `SELECT d.id, COALESCE(d.title, d.filename), d.relative_path, COALESCE(d.page_type, ''),
                das.relation, das.created_at
         FROM document_archive_sources das
         JOIN documents d ON d.id = das.document_id
         WHERE das.archive_file_id = $1
           AND COALESCE(d.deleted_at, '') = ''
         ORDER BY das.created_at DESC, d.relative_path ASC`,
        [archiveFileId],
      );
      return rows.map((row) => ({
        document_id: asString(row[0]),
        title: asString(row[1]),
        relative_path: asString(row[2]),
        page_type: asString(row[3]),
        relation: asString(row[4]),
        created_at: asString(row[5]),
      }));
    },
  };
}
