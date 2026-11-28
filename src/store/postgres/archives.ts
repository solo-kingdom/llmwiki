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
  ArchiveSearchHit,
  ArchiveSearchMatchType,
  ArchiveSourceSummary,
  ArchiveStorageBackend,
  DeleteArchiveFolderResult,
  FolderDeleteMode,
  MoveArchiveFolderResult,
} from "../types.js";
import { NOW_TEXT, asNumber, asString, asUtcTimestamp, exec, queryOne, queryRows, withTransaction } from "./sql.js";

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
  constructor(
    message: string,
    public readonly conflicts?: string[],
  ) {
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

export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Extract a concise, single-line snippet centered around the first query match. */
export function extractSearchSnippet(text: string, query: string, maxLen = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const q = query.trim();
  if (!q) {
    return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen).trimEnd()}…`;
  }

  const lowerText = normalized.toLowerCase();
  const lowerQ = q.toLowerCase();
  let matchIdx = lowerText.indexOf(lowerQ);
  if (matchIdx < 0) {
    const terms = lowerQ.split(/\s+/).filter(Boolean);
    for (const term of terms) {
      const idx = lowerText.indexOf(term);
      if (idx >= 0 && (matchIdx < 0 || idx < matchIdx)) {
        matchIdx = idx;
      }
    }
  }

  if (matchIdx < 0) {
    return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen).trimEnd()}…`;
  }

  const before = Math.min(60, Math.floor(maxLen / 3));
  let start = Math.max(0, matchIdx - before);
  if (start > 0) {
    const spaceIdx = normalized.indexOf(" ", start);
    if (spaceIdx > start && spaceIdx < matchIdx && matchIdx - spaceIdx <= before) {
      start = spaceIdx + 1;
    }
  }
  const end = Math.min(normalized.length, start + maxLen);
  const slice = normalized.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${slice}${end < normalized.length ? "…" : ""}`;
}

function isPgUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

const ARCHIVE_FILE_COLUMNS = `
  id, folder_path, filename, title, relative_path, media_type, kind, size, sha256,
  storage_backend, storage_key, origin, source_ref, ingest_job_id, created_at, updated_at`;

function scanFolder(row: unknown[]): ArchiveFolder {
  return {
    path: asString(row[0]),
    display_name: asString(row[1]),
    description: asString(row[2]),
    sort_order: asNumber(row[3]),
    created_at: asUtcTimestamp(row[4]),
    updated_at: asUtcTimestamp(row[5]),
  };
}

function scanArchiveFile(row: unknown[]): ArchiveFile {
  return {
    id: asString(row[0]),
    folder_path: asString(row[1]),
    filename: asString(row[2]),
    title: asString(row[3]),
    relative_path: asString(row[4]),
    media_type: asString(row[5]),
    kind: asString(row[6]) as ArchiveFileKind,
    size: asNumber(row[7]),
    sha256: asString(row[8]),
    storage_backend: asString(row[9]) as ArchiveStorageBackend,
    storage_key: asString(row[10]),
    origin: asString(row[11]) as ArchiveFileOrigin,
    source_ref: asString(row[12]),
    ingest_job_id: asString(row[13]),
    created_at: asUtcTimestamp(row[14]),
    updated_at: asUtcTimestamp(row[15]),
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

    async moveArchiveFolder(
      fromPathRaw: string,
      toPathRaw: string,
      options: { onConflict?: "fail" | "merge" } = {},
    ): Promise<MoveArchiveFolderResult> {
      const fromPath = validateArchiveFolderPath(fromPathRaw);
      const toPath = validateArchiveFolderPath(toPathRaw);
      const onConflict = options.onConflict ?? "fail";
      if (fromPath === toPath) {
        return { from_path: fromPath, to_path: toPath, moved_folders: 0, moved_files: 0 };
      }
      if (toPath.startsWith(`${fromPath}/`)) {
        throw new ArchiveValidationError("cannot move a folder into its own subfolder");
      }

      return withTransaction(pool, async (client) => {
        const src = await queryOne(client, `SELECT path FROM archive_folders WHERE path = $1 FOR UPDATE`, [fromPath]);
        if (!src) throw new ArchiveNotFoundError(`folder not found: ${fromPath}`);

        if (onConflict === "fail") {
          const conflict = await queryOne(
            client,
            `SELECT path FROM archive_folders WHERE path = $1 OR path LIKE $2 LIMIT 1`,
            [toPath, `${toPath}/%`],
          );
          if (conflict) throw new ArchiveConflictError(`target folder already exists: ${toPath}`);
        }

        const parent = parentFolderOf(toPath);
        if (parent) await ensureArchiveFoldersTx(client, [parent]);

        const subFolders = await queryRows<[string, string, string, number, string]>(
          client,
          `SELECT path, display_name, description, sort_order, created_at
           FROM archive_folders WHERE path = $1 OR path LIKE $2 ORDER BY length(path) ASC`,
          [fromPath, `${fromPath}/%`],
        );

        const files = await queryRows<[string, string, string]>(
          client,
          `SELECT id, folder_path, filename FROM archive_files
           WHERE folder_path = $1 OR folder_path LIKE $2 FOR UPDATE`,
          [fromPath, `${fromPath}/%`],
        );

        if (onConflict === "merge" && files.length > 0) {
          const nextRels = files.map(([, oldFolder, filename]) => {
            const suffix = oldFolder.slice(fromPath.length);
            return buildArchiveRelativePath(`${toPath}${suffix}`, filename);
          });
          const conflictRows = await queryRows<[string]>(
            client,
            `SELECT relative_path FROM archive_files WHERE relative_path = ANY($1::text[])`,
            [nextRels],
          );
          if (conflictRows.length > 0) {
            const conflicts = conflictRows.map((r) => asString(r[0]));
            throw new ArchiveConflictError(
              `target folder merge conflict on ${conflicts.length} file(s)`,
              conflicts,
            );
          }
        }

        for (const [oldFolder, displayName, description, sortOrder, createdAt] of subFolders) {
          const suffix = oldFolder.slice(fromPath.length);
          const nextFolder = `${toPath}${suffix}`;
          await client.query(
            `INSERT INTO archive_folders (path, display_name, description, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})
             ON CONFLICT (path) DO NOTHING`,
            [nextFolder, displayName, description, sortOrder, createdAt],
          );
        }

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
              throw new ArchiveConflictError(`target file path conflict: ${nextRel}`, [nextRel]);
            }
            throw error;
          }
        }

        await client.query(
          `DELETE FROM archive_folders WHERE path = $1 OR path LIKE $2`,
          [fromPath, `${fromPath}/%`],
        );

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
        const files = await queryRows<[string, string, string, string, string]>(
          client,
          `SELECT id, folder_path, filename, storage_backend, storage_key FROM archive_files
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

          // Pre-check all target file paths before mutating
          const nextMoves: Array<{ fileId: string; nextFolder: string; nextRel: string }> = [];
          for (const [fileId, oldFolder, filename] of files) {
            const subTail = oldFolder === folderPath ? "" : oldFolder.slice(folderPath.length + 1);
            const nextFolder = subTail ? (targetFolder ? `${targetFolder}/${subTail}` : subTail) : targetFolder;
            const nextRel = buildArchiveRelativePath(nextFolder, filename);
            nextMoves.push({ fileId, nextFolder, nextRel });
          }
          if (nextMoves.length > 0) {
            const conflictRows = await queryRows<[string]>(
              client,
              `SELECT relative_path FROM archive_files WHERE relative_path = ANY($1::text[])`,
              [nextMoves.map((m) => m.nextRel)],
            );
            if (conflictRows.length > 0) {
              const conflicts = conflictRows.map((r) => asString(r[0]));
              throw new ArchiveConflictError(
                `file already exists at target: ${conflicts[0]}`,
                conflicts,
              );
            }
          }

          // Preserve child subfolder hierarchy under targetFolder
          const childSubFolders = subFolders
            .map(([p]) => p)
            .filter((p) => p !== folderPath)
            .sort((a, b) => a.length - b.length);
          for (const oldChild of childSubFolders) {
            const subTail = oldChild.slice(folderPath.length + 1);
            const nextChild = targetFolder ? `${targetFolder}/${subTail}` : subTail;
            const metaRow = await queryOne<[string, string, number, string]>(
              client,
              `SELECT display_name, description, sort_order, created_at FROM archive_folders WHERE path = $1`,
              [oldChild],
            );
            await client.query(
              `INSERT INTO archive_folders (path, display_name, description, sort_order, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})
               ON CONFLICT (path) DO NOTHING`,
              [
                nextChild,
                asString(metaRow?.[0]) || path.posix.basename(nextChild),
                asString(metaRow?.[1]),
                asNumber(metaRow?.[2]),
                asString(metaRow?.[3]),
              ],
            );
          }

          for (const m of nextMoves) {
            await client.query(
              `UPDATE archive_files
               SET folder_path = $2, relative_path = $3, updated_at = ${NOW_TEXT}
               WHERE id = $1`,
              [m.fileId, m.nextFolder, m.nextRel],
            );
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
        for (const [, , , backend, key] of files) {
          if ((backend === "local" || backend === "s3") && key) {
            removedRefs.push({ storage_backend: backend as ArchiveStorageBackend, storage_key: key });
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
        clauses.push(`(filename ILIKE $${params.length} OR title ILIKE $${params.length} OR relative_path ILIKE $${params.length})`);
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

    async findArchiveFileBySha256(sha256: string, folderPath?: string): Promise<ArchiveFile | null> {
      const clean = sha256.trim();
      if (!clean) return null;
      if (folderPath !== undefined) {
        const norm = normalizeArchiveFolderPath(folderPath);
        const row = await queryOne(
          pool,
          `SELECT ${ARCHIVE_FILE_COLUMNS} FROM archive_files
           WHERE sha256 = $1 AND folder_path = $2
           ORDER BY created_at ASC LIMIT 1`,
          [clean, norm],
        );
        if (row) return scanArchiveFile(row);
      }
      const row = await queryOne(
        pool,
        `SELECT ${ARCHIVE_FILE_COLUMNS} FROM archive_files
         WHERE sha256 = $1
         ORDER BY created_at ASC LIMIT 1`,
        [clean],
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

    async createArchiveFile(
      file: ArchiveFile,
      inlineBytes: Uint8Array | null,
      searchableText = "",
    ): Promise<ArchiveFile> {
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
              id, folder_path, filename, title, relative_path, media_type, kind, size, sha256,
              storage_backend, storage_key, inline_bytes, searchable_text, origin, source_ref, ingest_job_id,
              created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,${NOW_TEXT},${NOW_TEXT})
            RETURNING ${ARCHIVE_FILE_COLUMNS}`,
            [
              id,
              folderPath,
              filename,
              file.title ?? "",
              relPath,
              file.media_type,
              file.kind,
              file.size,
              file.sha256,
              file.storage_backend,
              file.storage_key,
              inlineBytes ? Buffer.from(inlineBytes) : null,
              searchableText,
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

    async setArchiveFileIngestJobId(id: string, jobId: string): Promise<void> {
      if (!id || !jobId) return;
      await exec(
        pool,
        `UPDATE archive_files SET ingest_job_id = $2, updated_at = ${NOW_TEXT} WHERE id = $1`,
        [id, jobId],
      );
    },

    async updateArchiveFileTitle(id: string, title: string): Promise<ArchiveFile | null> {
      const row = await queryOne(
        pool,
        `UPDATE archive_files SET title = $2, updated_at = ${NOW_TEXT} WHERE id = $1 RETURNING ${ARCHIVE_FILE_COLUMNS}`,
        [id, title.trim()],
      );
      return row ? scanArchiveFile(row) : null;
    },

    async updateArchiveFileMeta(
      id: string,
      patch: { title?: string; source_ref?: string },
    ): Promise<ArchiveFile | null> {
      const existing = await this.getArchiveFile(id);
      if (!existing) return null;
      const nextTitle = patch.title !== undefined ? patch.title.trim() : (existing.title ?? "");
      const nextSourceRef =
        patch.source_ref !== undefined ? patch.source_ref.trim() : (existing.source_ref ?? "");
      const row = await queryOne(
        pool,
        `UPDATE archive_files
         SET title = $2, source_ref = $3, updated_at = ${NOW_TEXT}
         WHERE id = $1
         RETURNING ${ARCHIVE_FILE_COLUMNS}`,
        [id, nextTitle, nextSourceRef],
      );
      return row ? scanArchiveFile(row) : null;
    },

    async mergeDuplicateArchiveFiles(
      keepId: string,
      dropIds: string[],
      patch?: { folderPath?: string; filename?: string; title?: string },
    ): Promise<ArchiveFile> {
      const cleanDrops = dropIds.filter((id) => id && id !== keepId);
      return withTransaction(pool, async (client) => {
        const keeperRow = await queryOne(
          client,
          `SELECT ${ARCHIVE_FILE_COLUMNS} FROM archive_files WHERE id = $1 FOR UPDATE`,
          [keepId],
        );
        if (!keeperRow) throw new ArchiveNotFoundError(`archive file not found: ${keepId}`);
        let keeper = scanArchiveFile(keeperRow);

        for (const dropId of cleanDrops) {
          await client.query(
            `INSERT INTO document_archive_sources (document_id, archive_file_id, change_set_id, relation, created_at)
             SELECT document_id, $2, change_set_id, relation, created_at
             FROM document_archive_sources
             WHERE archive_file_id = $1
             ON CONFLICT (document_id, archive_file_id) DO NOTHING`,
            [dropId, keepId],
          );
          await client.query(`UPDATE change_sets SET archive_file_id = $2 WHERE archive_file_id = $1`, [dropId, keepId]);
          await client.query(`UPDATE ingest_jobs SET archive_file_id = $2 WHERE archive_file_id = $1`, [dropId, keepId]);
          await client.query(`UPDATE ingest_reviews SET archive_file_id = $2 WHERE archive_file_id = $1`, [dropId, keepId]);
          await client.query(`DELETE FROM archive_files WHERE id = $1`, [dropId]);
        }

        const nextFolder = patch?.folderPath !== undefined ? normalizeArchiveFolderPath(patch.folderPath) : keeper.folder_path;
        const nextFilename = patch?.filename !== undefined ? validateArchiveFilename(patch.filename) : keeper.filename;
        const nextTitle = patch?.title !== undefined ? patch.title.trim() : (keeper.title ?? "");
        const nextRel = buildArchiveRelativePath(nextFolder, nextFilename);
        if (nextFolder) await ensureArchiveFoldersTx(client, [nextFolder]);

        const updatedRow = await queryOne(
          client,
          `UPDATE archive_files
           SET folder_path = $2, filename = $3, relative_path = $4, title = $5, updated_at = ${NOW_TEXT}
           WHERE id = $1
           RETURNING ${ARCHIVE_FILE_COLUMNS}`,
          [keepId, nextFolder, nextFilename, nextRel, nextTitle],
        );
        if (updatedRow) keeper = scanArchiveFile(updatedRow);
        return keeper;
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
             searchable_text = COALESCE($9, searchable_text),
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
          patch.searchable_text ?? null,
        ],
      );
      if (!row) throw new ArchiveNotFoundError(`archive file not found: ${id}`);
      return scanArchiveFile(row);
    },

    async listArchiveFilesMissingSearchText(limit = 50): Promise<ArchiveFile[]> {
      const safeLimit = Math.max(1, Math.min(500, limit));
      const rows = await queryRows(
        pool,
        `SELECT ${ARCHIVE_FILE_COLUMNS} FROM archive_files
         WHERE searchable_text IS NULL
         ORDER BY updated_at DESC
         LIMIT $1`,
        [safeLimit],
      );
      return rows.map(scanArchiveFile);
    },

    async updateArchiveFileSearchableText(id: string, searchableText: string): Promise<void> {
      await exec(
        pool,
        `UPDATE archive_files SET searchable_text = $2 WHERE id = $1`,
        [id, searchableText],
      );
    },

    async searchArchiveFiles(
      query: string,
      options: { kind?: string; folder_path?: string; limit?: number } = {},
    ): Promise<ArchiveSearchHit[]> {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const safeLimit = Math.max(1, Math.min(50, options.limit ?? 20));
      const likePattern = `%${escapeLikePattern(trimmed)}%`;

      const clauses: string[] = [];
      const baseArgs: unknown[] = [trimmed, likePattern];
      if (options.kind && options.kind.trim() && options.kind.trim().toLowerCase() !== "all") {
        baseArgs.push(options.kind.trim().toLowerCase());
        clauses.push(`kind = $${baseArgs.length}`);
      }
      if (options.folder_path !== undefined && options.folder_path.trim() !== "") {
        const norm = normalizeArchiveFolderPath(options.folder_path);
        baseArgs.push(norm, `${norm}/%`);
        clauses.push(`(folder_path = $${baseArgs.length - 1} OR folder_path LIKE $${baseArgs.length})`);
      }
      const filterSql = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
      const limitParam = `$${baseArgs.length + 1}`;
      const args = [...baseArgs, safeLimit];

      const ftsSql = `
        SELECT ${ARCHIVE_FILE_COLUMNS},
          COALESCE(searchable_text, ''),
          (ts_rank_cd(to_tsvector('simple', COALESCE(searchable_text, '')), websearch_to_tsquery('simple', $1))
           + similarity(COALESCE(searchable_text, ''), $1)
           + CASE WHEN filename ILIKE $2 ESCAPE '\\' THEN 2.0
                  WHEN relative_path ILIKE $2 ESCAPE '\\' THEN 1.0
                  ELSE 0.0 END) AS score,
          (CASE
             WHEN (filename ILIKE $2 ESCAPE '\\' OR relative_path ILIKE $2 ESCAPE '\\')
              AND (to_tsvector('simple', COALESCE(searchable_text, '')) @@ websearch_to_tsquery('simple', $1)
                   OR COALESCE(searchable_text, '') ILIKE $2 ESCAPE '\\') THEN 3
             WHEN (filename ILIKE $2 ESCAPE '\\' OR relative_path ILIKE $2 ESCAPE '\\') THEN 2
             ELSE 1
           END) AS tier
        FROM archive_files
        WHERE (
          filename ILIKE $2 ESCAPE '\\'
          OR relative_path ILIKE $2 ESCAPE '\\'
          OR to_tsvector('simple', COALESCE(searchable_text, '')) @@ websearch_to_tsquery('simple', $1)
          OR COALESCE(searchable_text, '') ILIKE $2 ESCAPE '\\'
        )
        ${filterSql}
        ORDER BY tier DESC, score DESC, updated_at DESC
        LIMIT ${limitParam}`;

      const likeSql = `
        SELECT ${ARCHIVE_FILE_COLUMNS},
          COALESCE(searchable_text, ''),
          (CASE WHEN filename ILIKE $2 ESCAPE '\\' THEN 2.0
                WHEN relative_path ILIKE $2 ESCAPE '\\' THEN 1.0
                ELSE 0.5 END) AS score,
          (CASE
             WHEN (filename ILIKE $2 ESCAPE '\\' OR relative_path ILIKE $2 ESCAPE '\\')
              AND COALESCE(searchable_text, '') ILIKE $2 ESCAPE '\\' THEN 3
             WHEN (filename ILIKE $2 ESCAPE '\\' OR relative_path ILIKE $2 ESCAPE '\\') THEN 2
             ELSE 1
           END) AS tier
        FROM archive_files
        WHERE (
          filename ILIKE $2 ESCAPE '\\'
          OR relative_path ILIKE $2 ESCAPE '\\'
          OR COALESCE(searchable_text, '') ILIKE $2 ESCAPE '\\'
        )
        ${filterSql}
        ORDER BY tier DESC, score DESC, updated_at DESC
        LIMIT ${limitParam}`;

      let rows: unknown[][];
      try {
        rows = await queryRows(pool, ftsSql, args);
      } catch {
        rows = await queryRows(pool, likeSql, args);
      }

      const lowerQ = trimmed.toLowerCase();
      return rows.map((row) => {
        const file = scanArchiveFile(row);
        const searchableText = asString(row[16]);
        const score = Number(row[17] ?? 0);
        const tier = asNumber(row[18]);
        const nameHit = file.filename.toLowerCase().includes(lowerQ);
        const pathHit = file.relative_path.toLowerCase().includes(lowerQ);
        const contentHit = tier === 3 || (!nameHit && !pathHit);
        let matchType: ArchiveSearchMatchType = "content";
        if ((nameHit || pathHit) && contentHit) matchType = "both";
        else if (nameHit) matchType = "filename";
        else if (pathHit) matchType = "path";

        const snippet = contentHit
          ? extractSearchSnippet(searchableText, trimmed, 180)
          : extractSearchSnippet(searchableText, "", 140);
        return { file, match_type: matchType, snippet, score };
      });
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

    async unlinkDocumentArchiveSource(documentId: string, archiveFileId: string): Promise<boolean> {
      const affected = await exec(
        pool,
        `DELETE FROM document_archive_sources WHERE document_id = $1 AND archive_file_id = $2`,
        [documentId, archiveFileId],
      );
      return affected > 0;
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
        created_at: asUtcTimestamp(row[9]),
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
        created_at: asUtcTimestamp(row[5]),
      }));
    },
  };
}
