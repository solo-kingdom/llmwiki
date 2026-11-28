import path from "node:path";
import type { Context } from "hono";
import { logIngestJob, record } from "../activity/index.js";
import { ArchiveStorageService, isTextEditableKind } from "../archive/storage.js";
import { applyTextEdits, TextPatchError, type TextEdit } from "../engine/text_patch.js";
import { recordRulesSnapshot } from "../ingest/processor.js";
import {
  ArchiveConflictError,
  ArchiveNotFoundError,
  ArchiveValidationError,
  buildArchiveRelativePath,
  normalizeArchiveFolderPath,
  validateArchiveFilename,
} from "../store/postgres/archives.js";

const MAX_ARCHIVE_BATCH = 100;
const MAX_ARCHIVE_BULK_INGEST = 50;
const MAX_BATCH_TEXT_BYTES = 256 * 1024;
import type { ArchiveFile, FolderDeleteMode, IngestJob } from "../store/types.js";
import { getID, readJsonBody, writeError, writeJson, type ApiContext } from "./context.js";
import { SUPPORTED_INGEST_EXTENSIONS } from "./ingest_jobs.js";

function mapArchiveError(c: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ArchiveValidationError) return writeError(c, 400, message);
  if (error instanceof ArchiveNotFoundError) return writeError(c, 404, message);
  if (error instanceof ArchiveConflictError) {
    return writeJson(c, 409, {
      error: message,
      ...(error.conflicts?.length ? { conflicts: error.conflicts } : {}),
    });
  }
  return writeError(c, 500, message);
}

function parseArchiveIfMatch(header?: string): string {
  if (!header) return "";
  let cleaned = header.trim();
  if (cleaned.startsWith("W/")) cleaned = cleaned.slice(2).trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}

function checkArchiveConcurrency(
  c: Context,
  file: ArchiveFile,
  expectedSha256?: string,
): Response | null {
  let target = (expectedSha256 ?? "").trim();
  if (!target) {
    const ifMatch = parseArchiveIfMatch(c.req.header("if-match"));
    if (ifMatch && ifMatch !== "*") target = ifMatch;
  }
  if (target && file.sha256 !== target) {
    return writeJson(c, 409, {
      error: "archive content conflict",
      code: "CONTENT_CONFLICT",
      current_sha256: file.sha256,
    });
  }
  return null;
}

function isSandboxedMedia(file: ArchiveFile): boolean {
  const ext = path.extname(file.filename).toLowerCase();
  const mime = file.media_type.toLowerCase();
  return (
    file.kind === "html" ||
    mime.includes("html") ||
    mime.includes("svg") ||
    ext === ".html" ||
    ext === ".htm" ||
    ext === ".svg"
  );
}

export function archivesApi(ctx: ApiContext) {
  const storage = () => new ArchiveStorageService(ctx.db, ctx.workspace);

  async function serveArchiveRaw(c: Context, file: ArchiveFile): Promise<Response> {
    const download = c.req.query("download") === "1" || c.req.query("download") === "true";
    const rangeHeader = c.req.header("range");
    const res = await storage().openRangeStream(file, rangeHeader);

    const headers = new Headers();
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, max-age=60");

    if (isSandboxedMedia(file)) {
      headers.set("Content-Security-Policy", download ? "sandbox" : "sandbox allow-scripts");
    }

    if (res.status === 416) {
      headers.set("Content-Range", res.contentRange ?? `bytes */${res.totalSize}`);
      return new Response(null, { status: 416, headers });
    }

    headers.set("Content-Type", file.media_type || "application/octet-stream");
    headers.set("Content-Length", String(res.contentLength));
    if (res.status === 206 && res.contentRange) {
      headers.set("Content-Range", res.contentRange);
    }
    if (download) {
      headers.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      );
    }

    return new Response(res.stream ?? null, {
      status: res.status,
      headers,
    });
  }

  async function resolveArchiveByIdOrPath(id?: string, rawPath?: string): Promise<ArchiveFile | null> {
    const cleanId = (id ?? "").trim();
    if (cleanId) return ctx.db.getArchiveFile(cleanId);
    const cleanPath = (rawPath ?? "").trim().replace(/^\/+/, "");
    if (!cleanPath) return null;
    return ctx.db.getArchiveFileByRelativePath(cleanPath);
  }

  return {
    async getArchiveTree(c: Context): Promise<Response> {
      const folder = (c.req.query("folder") ?? "").trim();
      const kind = (c.req.query("kind") ?? "").trim();
      const q = (c.req.query("q") ?? "").trim();
      try {
        const normFolder = folder ? normalizeArchiveFolderPath(folder) : "";
        const [allFolders, files] = await Promise.all([
          ctx.db.listArchiveFolders(),
          ctx.db.listArchiveFiles({ folder_path: normFolder, kind, q }),
        ]);
        const folders = normFolder
          ? allFolders.filter((f) => f.path === normFolder || f.path.startsWith(`${normFolder}/`))
          : allFolders;
        return writeJson(c, 200, { folders, files });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async searchArchives(c: Context): Promise<Response> {
      const q = (c.req.query("q") ?? "").trim();
      if (!q) return writeError(c, 400, "query parameter 'q' is required");
      const kind = (c.req.query("kind") ?? "").trim();
      const folderPath = (c.req.query("folder") ?? "").trim();
      const rawLimit = Number.parseInt(c.req.query("limit") ?? "20", 10);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20;
      try {
        await storage().backfillSearchableText(50).catch(() => 0);
        const results = await ctx.db.searchArchiveFiles(q, {
          kind: kind || undefined,
          folder_path: folderPath || undefined,
          limit,
        });
        return writeJson(c, 200, { query: q, results });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async createArchiveFolder(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        path?: string;
        display_name?: string;
        description?: string;
        sort_order?: number;
        exist_ok?: boolean;
      }>(c);
      if (!req || !req.path) return writeError(c, 400, "path is required");
      try {
        const folder = await ctx.db.createArchiveFolder({
          path: req.path,
          display_name: req.display_name,
          description: req.description,
          sort_order: req.sort_order,
        });
        record(ctx.db, {
          level: "info",
          category: "archive",
          action: "folder_created",
          message: `创建档案目录 ${folder.path}`,
          resourceType: "archive_folder",
          resourceId: folder.path,
          source: "api",
        });
        return writeJson(c, 201, folder);
      } catch (error) {
        if (req.exist_ok && error instanceof ArchiveConflictError) {
          const existing = await ctx.db.getArchiveFolder(req.path);
          if (existing) return writeJson(c, 200, existing);
        }
        return mapArchiveError(c, error);
      }
    },

    async updateArchiveFolder(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        path?: string;
        display_name?: string;
        description?: string;
        sort_order?: number;
      }>(c);
      if (!req || !req.path) return writeError(c, 400, "path is required");
      try {
        const updated = await ctx.db.updateArchiveFolder(req.path, {
          display_name: req.display_name,
          description: req.description,
          sort_order: req.sort_order,
        });
        if (!updated) return writeError(c, 404, "archive folder not found");
        return writeJson(c, 200, updated);
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async moveArchiveFolder(c: Context): Promise<Response> {
      const req = await readJsonBody<{ from_path?: string; to_path?: string; on_conflict?: string }>(c);
      if (!req || !req.from_path || !req.to_path) {
        return writeError(c, 400, "from_path and to_path are required");
      }
      const rawConflict = (req.on_conflict ?? "fail").trim().toLowerCase();
      if (rawConflict !== "fail" && rawConflict !== "merge") {
        return writeError(c, 400, "on_conflict must be fail or merge");
      }
      try {
        const result = await ctx.db.moveArchiveFolder(req.from_path, req.to_path, {
          onConflict: rawConflict as "fail" | "merge",
        });
        record(ctx.db, {
          level: "info",
          category: "archive",
          action: "folder_moved",
          message: `移动档案目录 ${result.from_path} -> ${result.to_path}`,
          resourceType: "archive_folder",
          resourceId: result.to_path,
          source: "api",
        });
        return writeJson(c, 200, result);
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async deleteArchiveFolder(c: Context): Promise<Response> {
      const folderPath = (c.req.query("path") ?? "").trim();
      if (!folderPath) return writeError(c, 400, "query parameter 'path' is required");
      const rawMode = (c.req.query("mode") ?? "empty").trim();
      if (rawMode !== "empty" && rawMode !== "move_to_parent" && rawMode !== "cascade") {
        return writeError(c, 400, "mode must be empty, move_to_parent, or cascade");
      }
      const targetFolder = c.req.query("target_folder");
      try {
        const result = await storage().deleteFolder(
          folderPath,
          rawMode as FolderDeleteMode,
          targetFolder,
        );
        record(ctx.db, {
          level: "info",
          category: "archive",
          action: "folder_deleted",
          message: `删除档案目录 ${result.path}`,
          resourceType: "archive_folder",
          resourceId: result.path,
          source: "api",
        });
        return writeJson(c, 200, result);
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async uploadArchiveFiles(c: Context): Promise<Response> {
      const contentType = (c.req.header("content-type") ?? "").toLowerCase();
      if (contentType.includes("application/json")) {
        const req = await readJsonBody<{
          filename?: string;
          folder_path?: string;
          content?: string;
          content_base64?: string;
          title?: string;
          media_type?: string;
          source_ref?: string;
          overwrite?: boolean;
        }>(c);
        if (!req) return writeError(c, 400, "invalid request body");
        const filename = (req.filename ?? "").trim();
        if (!filename) return writeError(c, 400, "filename is required");
        if (req.content === undefined && req.content_base64 === undefined) {
          return writeError(c, 400, "either content or content_base64 is required");
        }
        const bytes =
          req.content_base64 !== undefined
            ? new Uint8Array(Buffer.from(req.content_base64, "base64"))
            : new Uint8Array(Buffer.from(req.content ?? "", "utf8"));
        try {
          const saved = await storage().storeNewFile({
            folderPath: (req.folder_path ?? "").trim(),
            filename,
            title: req.title,
            bytes,
            mediaType: req.media_type,
            origin: "upload",
            sourceRef: req.source_ref,
            overwrite: Boolean(req.overwrite),
            autoRename: false,
          });
          record(ctx.db, {
            level: "info",
            category: "archive",
            action: "file_uploaded",
            message: `上传档案文件 ${saved.relative_path}`,
            resourceType: "archive_file",
            resourceId: saved.id,
            source: "api",
          });
          return writeJson(c, 201, { file: saved, files: [saved] });
        } catch (error) {
          return mapArchiveError(c, error);
        }
      }

      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return writeError(c, 400, "invalid multipart form");
      }
      const entries = [...form.getAll("files"), ...form.getAll("file")].filter(
        (entry): entry is File => typeof entry !== "string",
      );
      if (entries.length === 0) return writeError(c, 400, "no files provided");
      const folderPath = String(form.get("folder_path") ?? "").trim();
      const rawOverwrite = String(form.get("overwrite") ?? "").trim().toLowerCase();
      const overwrite = rawOverwrite === "true" || rawOverwrite === "1";

      // Parse optional relative_paths (repeated form field or single JSON array string)
      const relPathEntries = form.getAll("relative_paths").map((v) => String(v).trim());
      let parsedRelPaths: string[] = [];
      if (relPathEntries.length === 1 && relPathEntries[0]?.startsWith("[")) {
        try {
          const parsed = JSON.parse(relPathEntries[0]);
          if (Array.isArray(parsed)) parsedRelPaths = parsed.map((v) => String(v).trim());
        } catch {
          parsedRelPaths = relPathEntries;
        }
      } else {
        parsedRelPaths = relPathEntries;
      }

      const svc = storage();
      const planned: Array<{
        item: File;
        targetFolder: string;
        filename: string;
        relPath: string;
      }> = [];
      try {
        for (let i = 0; i < entries.length; i += 1) {
          const item = entries[i]!;
          const rawRel = parsedRelPaths[i] || "";
          let targetFolder = folderPath;
          let filename = item.name.trim();
          if (rawRel) {
            const cleanRel = rawRel.replace(/\\/g, "/").replace(/^\/+/, "");
            const dir = path.posix.dirname(cleanRel);
            const base = path.posix.basename(cleanRel);
            if (base && base !== "." && base !== "..") filename = base;
            if (dir && dir !== ".") {
              targetFolder = targetFolder ? `${normalizeArchiveFolderPath(targetFolder)}/${dir}` : dir;
            }
          }
          targetFolder = normalizeArchiveFolderPath(targetFolder);
          filename = validateArchiveFilename(filename);
          const relPath = buildArchiveRelativePath(targetFolder, filename);
          planned.push({ item, targetFolder, filename, relPath });
        }

        if (!overwrite) {
          const conflicts: string[] = [];
          const seenBatchPaths = new Set<string>();
          for (const p of planned) {
            if (seenBatchPaths.has(p.relPath)) {
              conflicts.push(p.relPath);
              continue;
            }
            seenBatchPaths.add(p.relPath);
            const existing = await ctx.db.getArchiveFileByRelativePath(p.relPath);
            if (existing) conflicts.push(p.relPath);
          }
          if (conflicts.length > 0) {
            return writeJson(c, 409, {
              error: `archive upload conflict on ${conflicts.length} file(s)`,
              conflicts: [...new Set(conflicts)],
            });
          }
        }

        const uploaded: ArchiveFile[] = [];
        for (const p of planned) {
          const bytes = new Uint8Array(await p.item.arrayBuffer());
          const saved = await svc.storeNewFile({
            folderPath: p.targetFolder,
            filename: p.filename,
            bytes,
            mediaType: p.item.type || undefined,
            origin: "upload",
            overwrite,
            autoRename: false,
          });
          uploaded.push(saved);
          record(ctx.db, {
            level: "info",
            category: "archive",
            action: "file_uploaded",
            message: `上传档案文件 ${saved.relative_path}`,
            resourceType: "archive_file",
            resourceId: saved.id,
            source: "api",
          });
        }
        return writeJson(c, 201, { files: uploaded });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async getArchiveFile(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      try {
        const file = await ctx.db.getArchiveFile(id);
        if (!file) return writeError(c, 404, "archive file not found");
        const wikiDocuments =
          typeof ctx.db.listArchiveFileDocuments === "function"
            ? await ctx.db.listArchiveFileDocuments(file.id)
            : [];
        return writeJson(c, 200, { ...file, wiki_documents: wikiDocuments });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async getArchiveFileRaw(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      try {
        const file = await ctx.db.getArchiveFile(id);
        if (!file) return writeError(c, 404, "archive file not found");
        return await serveArchiveRaw(c, file);
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async getArchiveFileByPath(c: Context): Promise<Response> {
      const rawPath = (c.req.query("path") ?? "").trim().replace(/^\/+/, "");
      if (!rawPath) return writeError(c, 400, "query parameter 'path' is required");
      try {
        const file = await ctx.db.getArchiveFileByRelativePath(rawPath);
        if (!file) return writeError(c, 404, "archive file not found");
        const wikiDocuments =
          typeof ctx.db.listArchiveFileDocuments === "function"
            ? await ctx.db.listArchiveFileDocuments(file.id)
            : [];
        return writeJson(c, 200, { ...file, wiki_documents: wikiDocuments });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async getArchiveFileRawByPath(c: Context): Promise<Response> {
      const rawPath = (c.req.query("path") ?? "").trim().replace(/^\/+/, "");
      if (!rawPath) return writeError(c, 400, "query parameter 'path' is required");
      try {
        const file = await ctx.db.getArchiveFileByRelativePath(rawPath);
        if (!file) return writeError(c, 404, "archive file not found");
        return await serveArchiveRaw(c, file);
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async ingestArchiveFile(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      const req = (await readJsonBody<{ source_ref?: string }>(c)) ?? {};
      try {
        const file = await ctx.db.getArchiveFile(id);
        if (!file) return writeError(c, 404, "archive file not found");
        const ext = path.extname(file.filename).toLowerCase();
        if (!SUPPORTED_INGEST_EXTENSIONS.has(ext)) {
          return writeError(c, 400, `unsupported file extension for ingest: ${ext || "(none)"}`);
        }
        const job: IngestJob = {
          id: "",
          parent_job_id: "",
          input_type: "upload",
          source_path: file.relative_path,
          source_ref: (req.source_ref ?? "").trim() || `archive:${file.relative_path}`,
          archive_file_id: file.id,
          status: "queued",
          retries: 0,
          max_retries: 3,
          error: "",
          error_code: "",
          error_message: "",
          missing_dependency: "",
          remediation: "",
          result_summary: "",
          created_at: "",
          updated_at: "",
        };
        await ctx.db.createIngestJob(job);
        await recordRulesSnapshot(ctx.db, job.id, ctx.workspace);
        logIngestJob(ctx.db, job, "queued", "api");
        return writeJson(c, 201, { job, archive_file: file });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async linkDocumentArchiveSource(c: Context): Promise<Response> {
      const docId = getID(c);
      if (!docId) return writeError(c, 400, "missing document id");
      const req = await readJsonBody<{
        archive_file_id?: string;
        path?: string;
        relation?: string;
      }>(c);
      if (!req || (!req.archive_file_id && !req.path)) {
        return writeError(c, 400, "archive_file_id or path is required");
      }
      try {
        const doc = await ctx.db.getDocument(docId);
        if (!doc) return writeError(c, 404, "document not found");
        const file = await resolveArchiveByIdOrPath(req.archive_file_id, req.path);
        if (!file) return writeError(c, 404, "archive file not found");
        const relation = (req.relation ?? "").trim() || "manual_link";
        await ctx.db.linkDocumentArchiveSource(doc.id, file.id, "", relation);
        const archiveSources =
          typeof ctx.db.listDocumentArchiveSources === "function"
            ? await ctx.db.listDocumentArchiveSources(doc.id)
            : [];
        return writeJson(c, 201, {
          document_id: doc.id,
          archive_file_id: file.id,
          relation,
          archive_sources: archiveSources,
        });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async unlinkDocumentArchiveSource(c: Context): Promise<Response> {
      const docId = getID(c);
      const archiveId = c.req.param("archiveId") ?? "";
      if (!docId || !archiveId) return writeError(c, 400, "missing document or archive id");
      try {
        const doc = await ctx.db.getDocument(docId);
        if (!doc) return writeError(c, 404, "document not found");
        const unlinked = await ctx.db.unlinkDocumentArchiveSource(doc.id, archiveId);
        if (!unlinked) return writeError(c, 404, "archive source link not found");
        return writeJson(c, 200, {
          unlinked: true,
          document_id: doc.id,
          archive_file_id: archiveId,
        });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async updateArchiveFileLocation(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      const req = await readJsonBody<{
        folder_path?: string;
        filename?: string;
        title?: string;
        source_ref?: string;
      }>(c);
      if (
        !req ||
        (req.folder_path === undefined &&
          req.filename === undefined &&
          req.title === undefined &&
          req.source_ref === undefined)
      ) {
        return writeError(c, 400, "folder_path, filename, title, or source_ref is required");
      }
      try {
        const existing = await ctx.db.getArchiveFile(id);
        if (!existing) return writeError(c, 404, "archive file not found");
        let updated = existing;
        if (req.folder_path !== undefined || req.filename !== undefined) {
          const nextFolder = req.folder_path !== undefined ? req.folder_path : existing.folder_path;
          const nextFilename = req.filename !== undefined ? req.filename : existing.filename;
          updated = await ctx.db.updateArchiveFileLocation(id, nextFolder, nextFilename);
        }
        if (req.title !== undefined || req.source_ref !== undefined) {
          if (typeof ctx.db.updateArchiveFileMeta === "function") {
            const metaUpdated = await ctx.db.updateArchiveFileMeta(id, {
              title: req.title,
              source_ref: req.source_ref,
            });
            if (metaUpdated) updated = metaUpdated;
          } else if (req.title !== undefined && typeof ctx.db.updateArchiveFileTitle === "function") {
            const titleUpdated = await ctx.db.updateArchiveFileTitle(id, req.title);
            if (titleUpdated) updated = titleUpdated;
          }
        }
        return writeJson(c, 200, updated);
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async updateArchiveFileContent(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      const req = await readJsonBody<{ content?: string; expected_sha256?: string }>(c);
      if (!req || typeof req.content !== "string") {
        return writeError(c, 400, "content is required");
      }
      try {
        const existing = await ctx.db.getArchiveFile(id);
        if (!existing) return writeError(c, 404, "archive file not found");
        const conflict = checkArchiveConcurrency(c, existing, req.expected_sha256);
        if (conflict) return conflict;
        const bytes = Buffer.from(req.content, "utf8");
        const result = await storage().replaceFileBytes(existing, bytes);
        return writeJson(c, 200, {
          file: result.file,
          promoted: result.promoted,
          previous_backend: result.previousBackend,
        });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async patchArchiveFileContent(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      const req = await readJsonBody<{
        edits?: TextEdit[];
        expected_sha256?: string;
        dry_run?: boolean;
      }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      try {
        const existing = await ctx.db.getArchiveFile(id);
        if (!existing) return writeError(c, 404, "archive file not found");
        if (!isTextEditableKind(existing.kind)) {
          return writeError(c, 400, `archive file kind "${existing.kind}" is not text-patchable`);
        }
        const conflict = checkArchiveConcurrency(c, existing, req.expected_sha256);
        if (conflict) return conflict;

        const rawBytes = await storage().readFullBytes(existing);
        const text = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
        const patched = applyTextEdits(text, req.edits ?? []);
        if (req.dry_run) {
          return writeJson(c, 200, {
            dry_run: true,
            file_id: existing.id,
            relative_path: existing.relative_path,
            applied_edits: patched.applied_edits,
            changed: patched.changed,
            line_delta: patched.line_delta,
            current_sha256: existing.sha256,
            preview_content: patched.content,
          });
        }
        const bytes = Buffer.from(patched.content, "utf8");
        const result = await storage().replaceFileBytes(existing, bytes);
        return writeJson(c, 200, {
          file: result.file,
          promoted: result.promoted,
          previous_backend: result.previousBackend,
          applied_edits: patched.applied_edits,
          changed: patched.changed,
          line_delta: patched.line_delta,
        });
      } catch (error) {
        if (error instanceof TextPatchError) {
          return writeJson(c, error.status, {
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
          });
        }
        return mapArchiveError(c, error);
      }
    },

    async deleteArchiveFile(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      try {
        const deleted = await storage().deleteFile(id);
        if (!deleted) return writeError(c, 404, "archive file not found");
        record(ctx.db, {
          level: "info",
          category: "archive",
          action: "file_deleted",
          message: `删除档案文件 ${deleted.relative_path}`,
          resourceType: "archive_file",
          resourceId: deleted.id,
          source: "api",
        });
        return writeJson(c, 200, { deleted: true, id: deleted.id });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async batchGetArchiveFiles(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        ids?: string[];
        paths?: string[];
        include_text?: boolean;
      }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      const ids = Array.isArray(req.ids) ? req.ids.map((s) => String(s).trim()).filter(Boolean) : [];
      const paths = Array.isArray(req.paths) ? req.paths.map((s) => String(s).trim()).filter(Boolean) : [];
      if (ids.length === 0 && paths.length === 0) {
        return writeError(c, 400, "ids or paths is required");
      }
      if (ids.length + paths.length > MAX_ARCHIVE_BATCH) {
        return writeError(c, 400, `batch-get total items exceeds maximum ${MAX_ARCHIVE_BATCH}`);
      }
      const includeText = req.include_text === true;
      try {
        const seenIds = new Set<string>();
        const files: Array<Record<string, unknown>> = [];
        const notFound: string[] = [];

        const pushFile = async (file: ArchiveFile) => {
          if (seenIds.has(file.id)) return;
          seenIds.add(file.id);
          if (includeText && isTextEditableKind(file.kind) && file.size <= MAX_BATCH_TEXT_BYTES) {
            const bytes = await storage().readFullBytes(file);
            files.push({ ...file, text: new TextDecoder("utf-8", { fatal: false }).decode(bytes) });
          } else {
            files.push({ ...file });
          }
        };

        for (const id of ids) {
          const f = await ctx.db.getArchiveFile(id);
          if (!f) notFound.push(id);
          else await pushFile(f);
        }
        for (const rawPath of paths) {
          const f = await ctx.db.getArchiveFileByRelativePath(rawPath.replace(/^\/+/, ""));
          if (!f) notFound.push(rawPath);
          else await pushFile(f);
        }
        return writeJson(c, 200, { files, not_found: notFound });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async bulkMoveArchiveFiles(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        items?: Array<{ id?: string; path?: string; folder_path?: string; filename?: string }>;
        dry_run?: boolean;
      }>(c);
      if (!req || !Array.isArray(req.items) || req.items.length === 0) {
        return writeError(c, 400, "items array is required");
      }
      if (req.items.length > MAX_ARCHIVE_BATCH) {
        return writeError(c, 400, `items count exceeds maximum ${MAX_ARCHIVE_BATCH}`);
      }
      try {
        const resolved: Array<{
          file: ArchiveFile;
          nextFolder: string;
          nextFilename: string;
          nextRel: string;
        }> = [];
        const movingIds = new Set<string>();
        const targetPaths = new Set<string>();
        const conflicts: string[] = [];

        for (let i = 0; i < req.items.length; i += 1) {
          const item = req.items[i]!;
          const file = await resolveArchiveByIdOrPath(item.id, item.path);
          if (!file) {
            return writeError(c, 404, `archive file not found at item[${i}]`);
          }
          if (item.folder_path === undefined && item.filename === undefined) {
            return writeError(c, 400, `item[${i}] requires folder_path or filename`);
          }
          const nextFolder =
            item.folder_path !== undefined ? normalizeArchiveFolderPath(item.folder_path) : file.folder_path;
          const nextFilename =
            item.filename !== undefined ? validateArchiveFilename(item.filename) : file.filename;
          const nextRel = buildArchiveRelativePath(nextFolder, nextFilename);
          if (targetPaths.has(nextRel)) {
            conflicts.push(nextRel);
          }
          targetPaths.add(nextRel);
          movingIds.add(file.id);
          resolved.push({ file, nextFolder, nextFilename, nextRel });
        }

        for (const r of resolved) {
          if (r.nextRel === r.file.relative_path) continue;
          const existing = await ctx.db.getArchiveFileByRelativePath(r.nextRel);
          if (existing && !movingIds.has(existing.id)) {
            conflicts.push(r.nextRel);
          }
        }
        if (conflicts.length > 0) {
          return writeJson(c, 409, {
            error: `bulk move conflict on ${conflicts.length} path(s)`,
            conflicts: [...new Set(conflicts)],
          });
        }

        if (req.dry_run) {
          return writeJson(c, 200, {
            dry_run: true,
            ok: true,
            count: resolved.length,
            moves: resolved.map((r) => ({
              id: r.file.id,
              from: r.file.relative_path,
              to: r.nextRel,
            })),
          });
        }

        const updatedFiles: ArchiveFile[] = [];
        for (const r of resolved) {
          const updated = await ctx.db.updateArchiveFileLocation(r.file.id, r.nextFolder, r.nextFilename);
          updatedFiles.push(updated);
        }
        return writeJson(c, 200, { ok: true, moved: updatedFiles.length, files: updatedFiles });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async bulkDeleteArchiveFiles(c: Context): Promise<Response> {
      const req = await readJsonBody<{ ids?: string[]; paths?: string[] }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      const ids = Array.isArray(req.ids) ? req.ids.map((s) => String(s).trim()).filter(Boolean) : [];
      const paths = Array.isArray(req.paths) ? req.paths.map((s) => String(s).trim()).filter(Boolean) : [];
      if (ids.length === 0 && paths.length === 0) {
        return writeError(c, 400, "ids or paths is required");
      }
      if (ids.length + paths.length > MAX_ARCHIVE_BATCH) {
        return writeError(c, 400, `bulk-delete total items exceeds maximum ${MAX_ARCHIVE_BATCH}`);
      }
      try {
        const svc = storage();
        const deletedIds: string[] = [];
        const notFound: string[] = [];
        const seen = new Set<string>();

        for (const id of ids) {
          if (seen.has(id)) continue;
          const deleted = await svc.deleteFile(id);
          if (!deleted) notFound.push(id);
          else {
            seen.add(deleted.id);
            deletedIds.push(deleted.id);
          }
        }
        for (const rawPath of paths) {
          const found = await ctx.db.getArchiveFileByRelativePath(rawPath.replace(/^\/+/, ""));
          if (!found) {
            notFound.push(rawPath);
            continue;
          }
          if (seen.has(found.id)) continue;
          const deleted = await svc.deleteFile(found.id);
          if (deleted) {
            seen.add(deleted.id);
            deletedIds.push(deleted.id);
          }
        }
        return writeJson(c, 200, { deleted: deletedIds.length, deleted_ids: deletedIds, not_found: notFound });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async bulkIngestArchiveFiles(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        ids?: string[];
        paths?: string[];
        source_ref_prefix?: string;
      }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      const ids = Array.isArray(req.ids) ? req.ids.map((s) => String(s).trim()).filter(Boolean) : [];
      const paths = Array.isArray(req.paths) ? req.paths.map((s) => String(s).trim()).filter(Boolean) : [];
      if (ids.length === 0 && paths.length === 0) {
        return writeError(c, 400, "ids or paths is required");
      }
      if (ids.length + paths.length > MAX_ARCHIVE_BULK_INGEST) {
        return writeError(c, 400, `bulk-ingest total items exceeds maximum ${MAX_ARCHIVE_BULK_INGEST}`);
      }
      const prefix = (req.source_ref_prefix ?? "").trim();
      try {
        const jobs: IngestJob[] = [];
        const skipped: Array<{ target: string; reason: string }> = [];
        const seen = new Set<string>();

        const enqueueFile = async (file: ArchiveFile) => {
          if (seen.has(file.id)) return;
          seen.add(file.id);
          const ext = path.extname(file.filename).toLowerCase();
          if (!SUPPORTED_INGEST_EXTENSIONS.has(ext)) {
            skipped.push({ target: file.relative_path, reason: `unsupported extension: ${ext || "(none)"}` });
            return;
          }
          const job: IngestJob = {
            id: "",
            parent_job_id: "",
            input_type: "upload",
            source_path: file.relative_path,
            source_ref: prefix ? `${prefix}:${file.relative_path}` : `archive:${file.relative_path}`,
            archive_file_id: file.id,
            status: "queued",
            retries: 0,
            max_retries: 3,
            error: "",
            error_code: "",
            error_message: "",
            missing_dependency: "",
            remediation: "",
            result_summary: "",
            created_at: "",
            updated_at: "",
          };
          await ctx.db.createIngestJob(job);
          await recordRulesSnapshot(ctx.db, job.id, ctx.workspace);
          logIngestJob(ctx.db, job, "queued", "api");
          jobs.push(job);
        };

        for (const id of ids) {
          const f = await ctx.db.getArchiveFile(id);
          if (!f) skipped.push({ target: id, reason: "not_found" });
          else await enqueueFile(f);
        }
        for (const rawPath of paths) {
          const f = await ctx.db.getArchiveFileByRelativePath(rawPath.replace(/^\/+/, ""));
          if (!f) skipped.push({ target: rawPath, reason: "not_found" });
          else await enqueueFile(f);
        }
        return writeJson(c, 201, { queued: jobs.length, jobs, skipped });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async bulkLinkArchiveFiles(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        action?: "link" | "unlink";
        items?: Array<{ document_id: string; archive_file_id?: string; path?: string; relation?: string }>;
      }>(c);
      if (!req || !Array.isArray(req.items) || req.items.length === 0) {
        return writeError(c, 400, "items array is required");
      }
      if (req.items.length > MAX_ARCHIVE_BATCH) {
        return writeError(c, 400, `items count exceeds maximum ${MAX_ARCHIVE_BATCH}`);
      }
      const action = req.action ?? "link";
      if (action !== "link" && action !== "unlink") {
        return writeError(c, 400, "action must be link or unlink");
      }
      try {
        const results: Array<{ document_id: string; archive_file_id: string; status: string }> = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < req.items.length; i += 1) {
          const item = req.items[i]!;
          const docId = (item.document_id ?? "").trim();
          if (!docId) {
            errors.push({ index: i, error: "document_id is required" });
            continue;
          }
          const doc = await ctx.db.getDocument(docId);
          if (!doc) {
            errors.push({ index: i, error: `document not found: ${docId}` });
            continue;
          }
          const file = await resolveArchiveByIdOrPath(item.archive_file_id, item.path);
          if (!file) {
            errors.push({ index: i, error: `archive file not found: ${item.archive_file_id || item.path || ""}` });
            continue;
          }
          if (action === "link") {
            const relation = (item.relation ?? "").trim() || "manual_link";
            await ctx.db.linkDocumentArchiveSource(doc.id, file.id, "", relation);
            results.push({ document_id: doc.id, archive_file_id: file.id, status: "linked" });
          } else {
            const ok = await ctx.db.unlinkDocumentArchiveSource(doc.id, file.id);
            results.push({
              document_id: doc.id,
              archive_file_id: file.id,
              status: ok ? "unlinked" : "not_linked",
            });
          }
        }
        return writeJson(c, 200, {
          ok: errors.length === 0,
          action,
          processed: results.length,
          results,
          errors,
        });
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },
  };
}
