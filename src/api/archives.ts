import path from "node:path";
import type { Context } from "hono";
import { logIngestJob, record } from "../activity/index.js";
import { ArchiveStorageService } from "../archive/storage.js";
import { recordRulesSnapshot } from "../ingest/processor.js";
import {
  ArchiveConflictError,
  ArchiveNotFoundError,
  ArchiveValidationError,
} from "../store/postgres/archives.js";
import type { ArchiveFile, FolderDeleteMode, IngestJob } from "../store/types.js";
import { getID, readJsonBody, writeError, writeJson, type ApiContext } from "./context.js";
import { SUPPORTED_INGEST_EXTENSIONS } from "./ingest_jobs.js";

function mapArchiveError(c: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ArchiveValidationError) return writeError(c, 400, message);
  if (error instanceof ArchiveNotFoundError) return writeError(c, 404, message);
  if (error instanceof ArchiveConflictError) return writeError(c, 409, message);
  return writeError(c, 500, message);
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
      const kind = (c.req.query("kind") ?? "").trim();
      const q = (c.req.query("q") ?? "").trim();
      try {
        const [folders, files] = await Promise.all([
          ctx.db.listArchiveFolders(),
          ctx.db.listArchiveFiles({ kind, q }),
        ]);
        return writeJson(c, 200, { folders, files });
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
      const req = await readJsonBody<{ from_path?: string; to_path?: string }>(c);
      if (!req || !req.from_path || !req.to_path) {
        return writeError(c, 400, "from_path and to_path are required");
      }
      try {
        const result = await ctx.db.moveArchiveFolder(req.from_path, req.to_path);
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

      const uploaded: ArchiveFile[] = [];
      const svc = storage();
      try {
        for (const item of entries) {
          const filename = item.name.trim();
          const bytes = new Uint8Array(await item.arrayBuffer());
          const saved = await svc.storeNewFile({
            folderPath,
            filename,
            bytes,
            mediaType: item.type || undefined,
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
      if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
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
      const req = await readJsonBody<{ folder_path?: string; filename?: string }>(c);
      if (!req || (req.folder_path === undefined && req.filename === undefined)) {
        return writeError(c, 400, "folder_path or filename is required");
      }
      try {
        const existing = await ctx.db.getArchiveFile(id);
        if (!existing) return writeError(c, 404, "archive file not found");
        const nextFolder = req.folder_path !== undefined ? req.folder_path : existing.folder_path;
        const nextFilename = req.filename !== undefined ? req.filename : existing.filename;
        const updated = await ctx.db.updateArchiveFileLocation(id, nextFolder, nextFilename);
        return writeJson(c, 200, updated);
      } catch (error) {
        return mapArchiveError(c, error);
      }
    },

    async updateArchiveFileContent(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing archive file id");
      const req = await readJsonBody<{ content?: string }>(c);
      if (!req || typeof req.content !== "string") {
        return writeError(c, 400, "content is required");
      }
      try {
        const existing = await ctx.db.getArchiveFile(id);
        if (!existing) return writeError(c, 404, "archive file not found");
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
  };
}
