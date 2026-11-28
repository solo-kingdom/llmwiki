import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { rewriteWikiPathLinks, type PathRewrite } from "../../engine/link_rewriter.js";
import {
  ancestorFolderPaths,
  folderPathFromWikiRelPath,
  isWikiSystemPath,
  normalizeFolderPath,
  RESERVED_TOP_LEVEL_WIKI_PAGES,
  validateFolderPath,
  validateOptionalFolderPath,
  WIKI_HIDDEN_SUBDIRS,
} from "../../engine/wiki_org.js";
import type { FolderStore } from "../interfaces.js";
import type {
  DeleteFolderResult,
  Document,
  FolderDeleteMode,
  MoveDocumentResult,
  MoveFolderResult,
  WikiFolder,
  WikiFolderWithCounts,
} from "../types.js";
import { NOW_TEXT, asNumber, asString, asUtcTimestamp, exec, queryOne, queryRows, toDbUtcTimestamp, withTransaction } from "./sql.js";
import { parseStringArrayJson } from "./doc_meta.js";

export class FolderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderValidationError";
  }
}

export class FolderNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderNotFoundError";
  }
}

export class FolderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderConflictError";
  }
}

function validateFolderOrThrow(raw: string): string {
  try {
    return validateFolderPath(raw);
  } catch (error) {
    throw new FolderValidationError(error instanceof Error ? error.message : String(error));
  }
}

function validateOptionalFolderOrThrow(raw: string): string {
  try {
    return validateOptionalFolderPath(raw);
  } catch (error) {
    throw new FolderValidationError(error instanceof Error ? error.message : String(error));
  }
}

function isHiddenFolderPath(folderPath: string): boolean {
  const first = folderPath.split("/")[0] ?? "";
  return WIKI_HIDDEN_SUBDIRS.has(first);
}

function scanFolder(row: unknown[]): WikiFolder {
  return {
    path: asString(row[0]),
    display_name: asString(row[1]),
    description: asString(row[2]),
    sort_order: asNumber(row[3]),
    created_at: asUtcTimestamp(row[4]),
    updated_at: asUtcTimestamp(row[5]),
  };
}

function dirFromRelPath(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  if (dir === "." || dir === "/") return "/";
  return `/${dir.replace(/^\/+/, "")}/`;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * If `relative_path` is held by a soft-deleted row (`deleted_at != ''`), rename
 * that soft-deleted row to `__deleted/<id>/<old_relative_path>` so active moves/creates
 * do not collide with the global UNIQUE constraint on `documents(relative_path)`.
 */
export async function releaseSoftDeletedPath(
  client: PoolClient,
  targetRelPath: string,
): Promise<void> {
  const existing = await queryOne<[string, string]>(
    client,
    `SELECT id, COALESCE(deleted_at, '') FROM documents WHERE relative_path = $1 FOR UPDATE`,
    [targetRelPath],
  );
  if (!existing) return;
  const id = asString(existing[0]);
  const deletedAt = asString(existing[1]);
  if (!deletedAt) {
    throw new FolderConflictError(`target path already exists: ${targetRelPath}`);
  }
  const archivedPath = `__deleted/${id}/${targetRelPath}`;
  await client.query(
    `UPDATE documents SET relative_path = $2, path = $3 WHERE id = $1`,
    [id, archivedPath, dirFromRelPath(archivedPath)],
  );
}

export async function ensureFolderAncestorsTx(
  client: PoolClient,
  folderPath: string,
): Promise<void> {
  const ancestors = ancestorFolderPaths(folderPath);
  for (const anc of ancestors) {
    if (isHiddenFolderPath(anc)) continue;
    await client.query(
      `INSERT INTO wiki_folders (path) VALUES ($1) ON CONFLICT (path) DO NOTHING`,
      [anc],
    );
  }
}

async function insertRevisionInTx(
  client: PoolClient,
  changeSetId: string,
  documentId: string,
  relPath: string,
  operation: "update" | "delete" | "move",
  title: string,
  content: string,
  metadata: string,
  contentHash: string,
  sourceKind: string,
  fileType: string,
  actor: string,
): Promise<void> {
  let parentId = "";
  let revisionNo = 1;
  const latest = await queryOne<[string, number]>(
    client,
    `SELECT id, revision_no FROM page_revisions WHERE document_id = $1 ORDER BY revision_no DESC LIMIT 1`,
    [documentId],
  );
  if (latest) {
    parentId = asString(latest[0]);
    const prev = asNumber(latest[1]);
    if (prev > 0) revisionNo = prev + 1;
  }
  await client.query(
    `INSERT INTO page_revisions (
      id, document_id, relative_path, revision_no, parent_revision_id,
      change_set_id, operation, title, content, metadata, content_hash,
      source_kind, file_type, actor
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      randomUUID(),
      documentId,
      relPath,
      revisionNo,
      parentId,
      changeSetId,
      operation,
      title,
      content,
      metadata,
      contentHash,
      sourceKind,
      fileType,
      actor,
    ],
  );
}

async function rewriteLinksForMovedDocs(
  client: PoolClient,
  changeSetId: string,
  rewrites: PathRewrite[],
  actor: string,
): Promise<string[]> {
  if (rewrites.length === 0) return [];
  const rows = await queryRows(
    client,
    `SELECT id, relative_path, COALESCE(title, ''), COALESCE(content, ''), COALESCE(metadata, ''),
      COALESCE(source_kind, ''), COALESCE(file_type, ''), COALESCE(version, 0)
     FROM documents
     WHERE source_kind = 'wiki' AND status != 'failed' AND COALESCE(deleted_at, '') = ''
       AND relative_path NOT LIKE 'wiki/templates/%'`,
  );
  const updatedPaths: string[] = [];
  for (const row of rows) {
    const id = asString(row[0]);
    const relPath = asString(row[1]);
    const title = asString(row[2]);
    const content = asString(row[3]);
    const metadata = asString(row[4]);
    const sourceKind = asString(row[5]);
    const fileType = asString(row[6]);
    const version = asNumber(row[7]);

    const { content: nextContent, changed } = rewriteWikiPathLinks(content, rewrites, relPath);
    if (!changed) continue;
    const hash = sha256(nextContent);
    await client.query(
      `UPDATE documents SET content = $2, content_hash = $3, version = $4, updated_at = ${NOW_TEXT} WHERE id = $1`,
      [id, nextContent, hash, version + 1],
    );
    await insertRevisionInTx(
      client,
      changeSetId,
      id,
      relPath,
      "update",
      title,
      nextContent,
      metadata,
      hash,
      sourceKind,
      fileType,
      actor,
    );
    updatedPaths.push(relPath);
  }
  return updatedPaths;
}

function scanFullDocument(row: unknown[]): Document {
  let tags: string[] = [];
  const tagsRaw = asString(row[13]);
  if (tagsRaw && tagsRaw !== "[]") {
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      tags = [];
    }
  }
  return {
    id: asString(row[0]),
    user_id: asString(row[1]),
    filename: asString(row[2]),
    title: asString(row[3]),
    path: asString(row[4]),
    relative_path: asString(row[5]),
    source_kind: asString(row[6]),
    file_type: asString(row[7]),
    file_size: asNumber(row[8]),
    document_number: asNumber(row[9]),
    status: asString(row[10]),
    page_count: asNumber(row[11]),
    content: asString(row[12]),
    tags,
    date: asString(row[14]),
    metadata: asString(row[15]),
    error_message: asString(row[16]),
    version: asNumber(row[17]),
    parser: asString(row[18]),
    content_hash: asString(row[19]),
    stale_since: asUtcTimestamp(row[20]),
    highlights: asString(row[21]),
    created_at: asUtcTimestamp(row[22]),
    updated_at: asUtcTimestamp(row[23]),
    deleted_at: asUtcTimestamp(row[24]),
    page_type: asString(row[25]),
    confidence: asString(row[26]),
    page_status: asString(row[27]),
    experience_kind: asString(row[28]),
    last_verified: asString(row[29]),
    review_after: asString(row[30]),
    archived_at: asString(row[31]),
    archive_reason: asString(row[32]),
    superseded_by: asString(row[33]),
    aliases: parseStringArrayJson(asString(row[34])),
    symptoms: parseStringArrayJson(asString(row[35])),
  };
}

const FULL_DOC_COLS = `
  COALESCE(id, ''), COALESCE(user_id, ''), COALESCE(filename, ''), COALESCE(title, ''),
  COALESCE(path, ''), COALESCE(relative_path, ''), COALESCE(source_kind, ''),
  COALESCE(file_type, ''), COALESCE(file_size, 0), COALESCE(document_number, 0),
  COALESCE(status, ''), COALESCE(page_count, 0), COALESCE(content, ''),
  COALESCE(tags, '[]'), COALESCE(date, ''), COALESCE(metadata, ''),
  COALESCE(error_message, ''), COALESCE(version, 0), COALESCE(parser, ''),
  COALESCE(content_hash, ''), COALESCE(stale_since, ''), COALESCE(highlights, '[]'),
  COALESCE(created_at, ''), COALESCE(updated_at, ''), COALESCE(deleted_at, ''),
  COALESCE(page_type, ''),
  COALESCE(confidence, ''), COALESCE(page_status, ''), COALESCE(experience_kind, ''),
  COALESCE(last_verified, ''), COALESCE(review_after, ''), COALESCE(archived_at, ''),
  COALESCE(archive_reason, ''), COALESCE(superseded_by, ''),
  COALESCE(aliases, '[]'), COALESCE(symptoms, '[]')`;

export function foldersRepo(pool: Pool): FolderStore {
  return {
    async listFolders(excludeHidden = true, includeArchived = false): Promise<WikiFolderWithCounts[]> {
      const folderRows = await queryRows(
        pool,
        `SELECT path, display_name, description, sort_order, created_at, updated_at
         FROM wiki_folders
         ORDER BY sort_order ASC, path ASC`,
      );
      const folders = folderRows
        .map(scanFolder)
        .filter((f) => !excludeHidden || !isHiddenFolderPath(f.path));

      const archiveCond = includeArchived ? "" : " AND COALESCE(archived_at, '') = ''";
      const docRows = await queryRows<[string]>(
        pool,
        `SELECT relative_path
         FROM documents
         WHERE source_kind = 'wiki' AND status != 'failed' AND COALESCE(deleted_at, '') = ''${archiveCond}`,
      );

      const directCounts = new Map<string, number>();
      for (const row of docRows) {
        const rel = asString(row[0]);
        const folder = folderPathFromWikiRelPath(rel);
        if (!folder) continue;
        if (excludeHidden && isHiddenFolderPath(folder)) continue;
        directCounts.set(folder, (directCounts.get(folder) ?? 0) + 1);
      }

      return folders.map((folder) => {
        const direct = directCounts.get(folder.path) ?? 0;
        let total = direct;
        const prefix = `${folder.path}/`;
        for (const [docFolder, count] of directCounts) {
          if (docFolder.startsWith(prefix)) total += count;
        }
        return { ...folder, direct_count: direct, total_count: total };
      });
    },

    async getFolder(folderPath: string): Promise<WikiFolder | null> {
      const normalized = normalizeFolderPath(folderPath);
      if (!normalized) return null;
      const row = await queryOne(
        pool,
        `SELECT path, display_name, description, sort_order, created_at, updated_at
         FROM wiki_folders WHERE path = $1`,
        [normalized],
      );
      return row ? scanFolder(row) : null;
    },

    async ensureFolders(folderPaths: string[]): Promise<void> {
      const all = new Set<string>();
      for (const raw of folderPaths) {
        const normalized = normalizeFolderPath(raw);
        if (!normalized || isHiddenFolderPath(normalized)) continue;
        for (const anc of ancestorFolderPaths(normalized)) all.add(anc);
      }
      if (all.size === 0) return;
      await withTransaction(pool, async (client) => {
        for (const folder of all) {
          await client.query(
            `INSERT INTO wiki_folders (path) VALUES ($1) ON CONFLICT (path) DO NOTHING`,
            [folder],
          );
        }
      });
    },

    async createFolder(input): Promise<WikiFolder> {
      const folderPath = validateFolderOrThrow(input.path);
      const displayName = (input.display_name ?? "").trim();
      const description = (input.description ?? "").trim();
      const sortOrder = Number.isFinite(input.sort_order) ? Number(input.sort_order) : 0;

      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('llmwiki:workspace'))");
        const existing = await queryOne(client, `SELECT path FROM wiki_folders WHERE path = $1`, [folderPath]);
        if (existing) {
          throw new FolderConflictError(`folder already exists: ${folderPath}`);
        }
        const ancestors = ancestorFolderPaths(folderPath);
        for (const anc of ancestors) {
          if (anc === folderPath) continue;
          await client.query(
            `INSERT INTO wiki_folders (path) VALUES ($1) ON CONFLICT (path) DO NOTHING`,
            [anc],
          );
        }
        await client.query(
          `INSERT INTO wiki_folders (path, display_name, description, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [folderPath, displayName, description, sortOrder],
        );
        const created = await queryOne(
          client,
          `SELECT path, display_name, description, sort_order, created_at, updated_at
           FROM wiki_folders WHERE path = $1`,
          [folderPath],
        );
        return scanFolder(created!);
      });
    },

    async updateFolder(folderPath, patch): Promise<WikiFolder | null> {
      const normalized = validateFolderOrThrow(folderPath);
      const row = await queryOne(
        pool,
        `SELECT path, display_name, description, sort_order, created_at, updated_at
         FROM wiki_folders WHERE path = $1`,
        [normalized],
      );
      if (!row) return null;
      const current = scanFolder(row);
      const displayName = patch.display_name !== undefined ? patch.display_name.trim() : current.display_name;
      const description = patch.description !== undefined ? patch.description.trim() : current.description;
      const sortOrder =
        patch.sort_order !== undefined && Number.isFinite(patch.sort_order)
          ? Number(patch.sort_order)
          : current.sort_order;

      await exec(
        pool,
        `UPDATE wiki_folders
         SET display_name = $2, description = $3, sort_order = $4, updated_at = ${NOW_TEXT}
         WHERE path = $1`,
        [normalized, displayName, description, sortOrder],
      );
      const updated = await queryOne(
        pool,
        `SELECT path, display_name, description, sort_order, created_at, updated_at
         FROM wiki_folders WHERE path = $1`,
        [normalized],
      );
      return updated ? scanFolder(updated) : null;
    },

    async moveDocument(docId, targetFolder, newFilename, actor = "api"): Promise<MoveDocumentResult> {
      const folder = validateOptionalFolderOrThrow(targetFolder);
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('llmwiki:workspace'))");
        const row = await queryOne(
          client,
          `SELECT ${FULL_DOC_COLS} FROM documents WHERE id = $1 AND COALESCE(deleted_at, '') = '' FOR UPDATE`,
          [docId],
        );
        if (!row) throw new FolderNotFoundError(`document not found: ${docId}`);
        const doc = scanFullDocument(row);
        if (doc.source_kind !== "wiki") {
          throw new FolderValidationError("only wiki documents can be moved between folders");
        }
        if (RESERVED_TOP_LEVEL_WIKI_PAGES.has(doc.relative_path) || isWikiSystemPath(doc.relative_path)) {
          throw new FolderValidationError(`system page cannot be moved: ${doc.relative_path}`);
        }
        const oldRelPath = doc.relative_path;
        let filename = (newFilename ?? "").trim() || doc.filename;
        filename = path.posix.basename(filename.replace(/\\/g, "/"));
        if (!filename || filename === "." || filename === "..") {
          throw new FolderValidationError(`invalid filename: ${filename}`);
        }
        if (!filename.toLowerCase().endsWith(".md")) filename += ".md";

        const newRelPath = folder ? `wiki/${folder}/${filename}` : `wiki/${filename}`;
        if (!folder && RESERVED_TOP_LEVEL_WIKI_PAGES.has(newRelPath)) {
          throw new FolderValidationError(`filename is reserved for a system page: ${newRelPath}`);
        }
        if (newRelPath === oldRelPath) {
          return {
            document: doc,
            old_relative_path: oldRelPath,
            change_set_id: "",
            updated_link_paths: [],
          };
        }

        await releaseSoftDeletedPath(client, newRelPath);
        await ensureFolderAncestorsTx(client, folder);

        const newDir = `/${path.posix.dirname(newRelPath)}/`;
        const nextVersion = doc.version + 1;
        await client.query(
          `UPDATE documents
           SET path = $2, relative_path = $3, filename = $4, version = $5, updated_at = ${NOW_TEXT}
           WHERE id = $1`,
          [doc.id, newDir, newRelPath, filename, nextVersion],
        );

        const changeSetId = randomUUID();
        await client.query(
          `INSERT INTO change_sets (id, kind, summary) VALUES ($1, 'manual', $2)`,
          [changeSetId, `move ${oldRelPath} -> ${newRelPath}`],
        );
        await insertRevisionInTx(
          client,
          changeSetId,
          doc.id,
          newRelPath,
          "move",
          doc.title,
          doc.content,
          doc.metadata,
          doc.content_hash,
          doc.source_kind,
          doc.file_type,
          actor,
        );

        const updatedLinkPaths = await rewriteLinksForMovedDocs(
          client,
          changeSetId,
          [{ oldRelPath, newRelPath }],
          actor,
        );

        const refreshed = await queryOne(
          client,
          `SELECT ${FULL_DOC_COLS} FROM documents WHERE id = $1`,
          [doc.id],
        );
        return {
          document: scanFullDocument(refreshed!),
          old_relative_path: oldRelPath,
          change_set_id: changeSetId,
          updated_link_paths: updatedLinkPaths,
        };
      });
    },

    async moveFolder(fromPath, toPath, actor = "api"): Promise<MoveFolderResult> {
      const from = validateFolderOrThrow(fromPath);
      const to = validateFolderOrThrow(toPath);
      if (from === to) {
        throw new FolderValidationError("source and target folder paths are identical");
      }
      if (to.startsWith(`${from}/`)) {
        throw new FolderValidationError(`cannot move folder "${from}" into its own descendant "${to}"`);
      }

      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('llmwiki:workspace'))");

        const folderRows = await queryRows(
          client,
          `SELECT path, display_name, description, sort_order, created_at, updated_at
           FROM wiki_folders
           WHERE path = $1 OR path LIKE $2
           ORDER BY length(path) ASC`,
          [from, `${from}/%`],
        );
        if (folderRows.length === 0) {
          throw new FolderNotFoundError(`folder not found: ${from}`);
        }
        const movingFolders = folderRows.map(scanFolder);

        // Ensure target folder and its descendants don't conflict with existing folders
        const targetConflict = await queryOne(
          client,
          `SELECT path FROM wiki_folders WHERE path = $1 OR path LIKE $2 LIMIT 1`,
          [to, `${to}/%`],
        );
        if (targetConflict) {
          throw new FolderConflictError(`target folder already exists: ${asString(targetConflict[0])}`);
        }

        const docRows = await queryRows(
          client,
          `SELECT ${FULL_DOC_COLS} FROM documents
           WHERE source_kind = 'wiki' AND COALESCE(deleted_at, '') = ''
             AND (relative_path LIKE $1)
           ORDER BY relative_path ASC
           FOR UPDATE`,
          [`wiki/${from}/%`],
        );
        const movingDocs = docRows.map(scanFullDocument);

        const parentOfTo = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
        if (parentOfTo) await ensureFolderAncestorsTx(client, parentOfTo);

        // Insert new folder rows (preserving metadata) then delete old folder rows
        for (const folder of movingFolders) {
          const suffix = folder.path.slice(from.length);
          const nextPath = `${to}${suffix}`;
          validateFolderOrThrow(nextPath);
          await client.query(
            `INSERT INTO wiki_folders (path, display_name, description, sort_order, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})`,
            [nextPath, folder.display_name, folder.description, folder.sort_order, toDbUtcTimestamp(folder.created_at)],
          );
        }
        await client.query(`DELETE FROM wiki_folders WHERE path = $1 OR path LIKE $2`, [from, `${from}/%`]);

        const changeSetId = randomUUID();
        await client.query(
          `INSERT INTO change_sets (id, kind, summary) VALUES ($1, 'manual', $2)`,
          [changeSetId, `move folder ${from} -> ${to}`],
        );

        const rewrites: PathRewrite[] = [];
        const movedDocPaths: string[] = [];
        for (const doc of movingDocs) {
          const oldRel = doc.relative_path;
          const tail = oldRel.slice(`wiki/${from}/`.length);
          const newRel = `wiki/${to}/${tail}`;
          await releaseSoftDeletedPath(client, newRel);
          const newDir = dirFromRelPath(newRel);
          await client.query(
            `UPDATE documents
             SET path = $2, relative_path = $3, version = $4, updated_at = ${NOW_TEXT}
             WHERE id = $1`,
            [doc.id, newDir, newRel, doc.version + 1],
          );
          await insertRevisionInTx(
            client,
            changeSetId,
            doc.id,
            newRel,
            "move",
            doc.title,
            doc.content,
            doc.metadata,
            doc.content_hash,
            doc.source_kind,
            doc.file_type,
            actor,
          );
          rewrites.push({ oldRelPath: oldRel, newRelPath: newRel });
          movedDocPaths.push(newRel);
        }

        const updatedLinkPaths = await rewriteLinksForMovedDocs(client, changeSetId, rewrites, actor);

        return {
          from_path: from,
          to_path: to,
          moved_folders: movingFolders.length,
          moved_documents: movingDocs.length,
          moved_doc_paths: movedDocPaths,
          change_set_id: changeSetId,
          updated_link_paths: updatedLinkPaths,
        };
      });
    },

    async deleteFolder(folderPath, mode, targetFolder = "", actor = "api"): Promise<DeleteFolderResult> {
      const folder = validateFolderOrThrow(folderPath);
      const destOverride = validateOptionalFolderOrThrow(targetFolder);
      const parentFolder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";

      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('llmwiki:workspace'))");

        const folderRows = await queryRows(
          client,
          `SELECT path FROM wiki_folders WHERE path = $1 OR path LIKE $2 ORDER BY length(path) ASC`,
          [folder, `${folder}/%`],
        );
        if (folderRows.length === 0) {
          throw new FolderNotFoundError(`folder not found: ${folder}`);
        }

        const docRows = await queryRows(
          client,
          `SELECT ${FULL_DOC_COLS} FROM documents
           WHERE source_kind = 'wiki' AND COALESCE(deleted_at, '') = ''
             AND relative_path LIKE $1
           ORDER BY relative_path ASC
           FOR UPDATE`,
          [`wiki/${folder}/%`],
        );
        const docs = docRows.map(scanFullDocument);

        if (mode === "empty") {
          if (folderRows.length > 1 || docs.length > 0) {
            throw new FolderConflictError(
              `folder "${folder}" is not empty (${docs.length} document(s), ${folderRows.length - 1} subfolder(s))`,
            );
          }
          await client.query(`DELETE FROM wiki_folders WHERE path = $1`, [folder]);
          return {
            path: folder,
            mode,
            deleted_folders: 1,
            moved_documents: 0,
            deleted_documents: 0,
            change_set_id: "",
          };
        }

        if (mode === "move_to_parent") {
          const fallbackTarget = destOverride || parentFolder;
          if (!fallbackTarget) {
            throw new FolderValidationError(
              "top-level folder requires target_folder when deleting with move_to_parent",
            );
          }
          if (fallbackTarget === folder || fallbackTarget.startsWith(`${folder}/`)) {
            throw new FolderValidationError("target_folder cannot be inside the deleted folder");
          }
          await ensureFolderAncestorsTx(client, fallbackTarget);

          const changeSetId = randomUUID();
          await client.query(
            `INSERT INTO change_sets (id, kind, summary) VALUES ($1, 'manual', $2)`,
            [changeSetId, `delete folder ${folder} (move contents to ${fallbackTarget})`],
          );

          // Move child subfolders under fallbackTarget, keeping their relative sub-paths
          const childFolders = folderRows
            .map((r) => asString(r[0]))
            .filter((p) => p !== folder);
          for (const child of childFolders) {
            const tail = child.slice(folder.length + 1);
            const nextChild = `${fallbackTarget}/${tail}`;
            validateFolderOrThrow(nextChild);
            const oldRow = await queryOne(
              client,
              `SELECT display_name, description, sort_order, created_at FROM wiki_folders WHERE path = $1`,
              [child],
            );
            await client.query(
              `INSERT INTO wiki_folders (path, display_name, description, sort_order, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})
               ON CONFLICT (path) DO NOTHING`,
              [
                nextChild,
                asString(oldRow?.[0]),
                asString(oldRow?.[1]),
                asNumber(oldRow?.[2]),
                asString(oldRow?.[3]),
              ],
            );
          }

          const rewrites: PathRewrite[] = [];
          for (const doc of docs) {
            const oldRel = doc.relative_path;
            const tail = oldRel.slice(`wiki/${folder}/`.length);
            const newRel = `wiki/${fallbackTarget}/${tail}`;
            await releaseSoftDeletedPath(client, newRel);
            const newDir = dirFromRelPath(newRel);
            await client.query(
              `UPDATE documents
               SET path = $2, relative_path = $3, version = $4, updated_at = ${NOW_TEXT}
               WHERE id = $1`,
              [doc.id, newDir, newRel, doc.version + 1],
            );
            await insertRevisionInTx(
              client,
              changeSetId,
              doc.id,
              newRel,
              "move",
              doc.title,
              doc.content,
              doc.metadata,
              doc.content_hash,
              doc.source_kind,
              doc.file_type,
              actor,
            );
            rewrites.push({ oldRelPath: oldRel, newRelPath: newRel });
          }

          await rewriteLinksForMovedDocs(client, changeSetId, rewrites, actor);
          await client.query(`DELETE FROM wiki_folders WHERE path = $1 OR path LIKE $2`, [folder, `${folder}/%`]);

          return {
            path: folder,
            mode,
            deleted_folders: 1,
            moved_documents: docs.length,
            deleted_documents: 0,
            change_set_id: docs.length > 0 ? changeSetId : "",
          };
        }

        // mode === "cascade"
        const changeSetId = randomUUID();
        if (docs.length > 0) {
          await client.query(
            `INSERT INTO change_sets (id, kind, summary) VALUES ($1, 'delete', $2)`,
            [changeSetId, `cascade delete folder ${folder} (${docs.length} page(s))`],
          );
          for (const doc of docs) {
            await client.query(
              `UPDATE documents SET deleted_at = (${NOW_TEXT}), updated_at = (${NOW_TEXT}) WHERE id = $1`,
              [doc.id],
            );
            await client.query(`DELETE FROM document_chunks WHERE document_id = $1`, [doc.id]);
            await client.query(`DELETE FROM document_references WHERE source_document_id = $1`, [doc.id]);
            await insertRevisionInTx(
              client,
              changeSetId,
              doc.id,
              doc.relative_path,
              "delete",
              doc.title,
              doc.content,
              doc.metadata,
              doc.content_hash,
              doc.source_kind,
              doc.file_type,
              actor,
            );
          }
        }
        await client.query(`DELETE FROM wiki_folders WHERE path = $1 OR path LIKE $2`, [folder, `${folder}/%`]);
        return {
          path: folder,
          mode,
          deleted_folders: folderRows.length,
          moved_documents: 0,
          deleted_documents: docs.length,
          change_set_id: docs.length > 0 ? changeSetId : "",
        };
      });
    },
  };
}
