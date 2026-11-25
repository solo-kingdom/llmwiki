import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import { logIngestJob } from "../activity/index.js";
import { ArchiveStorageService, ingestAutoFolder } from "../archive/storage.js";
import { normalizeConversation, normalizeText, normalizeUpload } from "../ingest/normalize.js";
import { recordRulesSnapshot } from "../ingest/processor.js";
import type { ArchiveFileOrigin, IngestJob } from "../store/types.js";
import {
  getID,
  parseQueryInt,
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

const IMAGE_SOURCE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const TEXT_SOURCE_EXTENSIONS = new Set([".md", ".txt"]);

export const SUPPORTED_INGEST_EXTENSIONS = new Set([
  ".md", ".txt", ".pdf",
  ".doc", ".docx",
  ".ppt", ".pptx",
  ".xls", ".xlsx",
  ".csv", ".json", ".xml",
  ".html", ".htm",
  ".png", ".jpg", ".jpeg",
  ".gif", ".webp", ".svg",
  ".zip", ".rar", ".7z",
]);

function newJob(
  inputType: string,
  sourcePath: string,
  sourceRef: string,
  archiveFileId = "",
): IngestJob {
  return {
    id: "",
    parent_job_id: "",
    input_type: inputType,
    source_path: sourcePath,
    source_ref: sourceRef,
    archive_file_id: archiveFileId,
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
}

export function ingestJobsApi(ctx: ApiContext) {
  function requireWorkspace(c: Context): Response | null {
    if (!ctx.workspace.trim()) return writeError(c, 503, "workspace not configured for ingest");
    return null;
  }

  async function persistArchiveSource(
    origin: ArchiveFileOrigin,
    filename: string,
    bytes: Uint8Array,
    sourceRef: string,
    archiveFolder?: string,
    mediaType?: string,
  ) {
    const svc = new ArchiveStorageService(ctx.db, ctx.workspace);
    const folderPath = (archiveFolder ?? "").trim() || ingestAutoFolder(origin, new Date());
    return svc.storeNewFile({
      folderPath,
      filename,
      bytes,
      mediaType,
      origin,
      sourceRef,
      autoRename: true,
    });
  }

  async function createQueuedJob(
    inputType: string,
    sourcePath: string,
    sourceRef: string,
    archiveFileId = "",
  ): Promise<IngestJob> {
    const job = newJob(inputType, sourcePath, sourceRef, archiveFileId);
    await ctx.db.createIngestJob(job);
    await recordRulesSnapshot(ctx.db, job.id, ctx.workspace);
    logIngestJob(ctx.db, job, "queued", "api");
    return job;
  }

  return {
    async createConversationIngestJob(c: Context): Promise<Response> {
      const denied = requireWorkspace(c);
      if (denied) return denied;
      const req = await readJsonBody<{
        content?: string;
        title?: string;
        source_ref?: string;
        archive_folder?: string;
      }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (!(req.content ?? "").trim()) return writeError(c, 400, "content is required");
      try {
        const normalized = normalizeConversation(req.title ?? "", req.content ?? "", req.source_ref ?? "", new Date());
        const archiveFile = await persistArchiveSource(
          "ingest_conversation",
          normalized.originalName,
          normalized.content,
          normalized.sourceRef,
          req.archive_folder,
          "text/markdown; charset=utf-8",
        );
        const job = await createQueuedJob(
          normalized.kind,
          archiveFile.relative_path,
          normalized.sourceRef,
          archiveFile.id,
        );
        return writeJson(c, 201, { job, archive_file: archiveFile });
      } catch (error) {
        return writeError(c, 500, `persist source failed: ${errorMessage(error)}`);
      }
    },

    async createTextIngestJob(c: Context): Promise<Response> {
      const denied = requireWorkspace(c);
      if (denied) return denied;
      const req = await readJsonBody<{
        content?: string;
        filename?: string;
        title?: string;
        source_ref?: string;
        archive_folder?: string;
      }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (!(req.content ?? "").trim()) return writeError(c, 400, "content is required");
      try {
        const normalized = normalizeText(
          req.title ?? "",
          req.filename ?? "",
          req.content ?? "",
          req.source_ref ?? "",
          new Date(),
        );
        const archiveFile = await persistArchiveSource(
          "ingest_text",
          normalized.originalName,
          normalized.content,
          normalized.sourceRef,
          req.archive_folder,
        );
        const job = await createQueuedJob(
          normalized.kind,
          archiveFile.relative_path,
          normalized.sourceRef,
          archiveFile.id,
        );
        return writeJson(c, 201, { job, archive_file: archiveFile });
      } catch (error) {
        return writeError(c, 500, `persist source failed: ${errorMessage(error)}`);
      }
    },

    async createUploadIngestJobs(c: Context): Promise<Response> {
      const denied = requireWorkspace(c);
      if (denied) return denied;
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return writeError(c, 400, "invalid multipart form");
      }
      const files = [...form.getAll("files"), ...form.getAll("file")].filter(
        (entry): entry is File => typeof entry !== "string",
      );
      if (files.length === 0) return writeError(c, 400, "no files provided");
      const sourceRef = String(form.get("source_ref") ?? "").trim() || "upload";
      const archiveFolder = String(form.get("archive_folder") ?? "").trim();

      const accepted: Array<{
        filename: string;
        job_id: string;
        status: string;
        source_path: string;
        archive_file_id: string;
      }> = [];
      const rejected: Array<{ filename: string; error_code: string; message: string; remediation?: string }> = [];

      for (const file of files) {
        const name = file.name.trim();
        const ext = path.extname(name).toLowerCase();
        if (!SUPPORTED_INGEST_EXTENSIONS.has(ext)) {
          rejected.push({
            filename: name,
            error_code: "unsupported_file_type",
            message: `unsupported file extension: ${ext}`,
            remediation: "upload a supported text, office, image, or archive file",
          });
          continue;
        }
        let data: Uint8Array;
        try {
          data = new Uint8Array(await file.arrayBuffer());
        } catch (error) {
          rejected.push({ filename: name, error_code: "read_failed", message: errorMessage(error) });
          continue;
        }
        let normalized;
        try {
          normalized = normalizeUpload(name, data, sourceRef);
        } catch (error) {
          rejected.push({ filename: name, error_code: "invalid_upload_input", message: errorMessage(error) });
          continue;
        }
        let archiveFile;
        try {
          archiveFile = await persistArchiveSource(
            "ingest_upload",
            normalized.originalName,
            normalized.content,
            normalized.sourceRef,
            archiveFolder,
            file.type || undefined,
          );
        } catch (error) {
          rejected.push({
            filename: name,
            error_code: "persist_failed",
            message: errorMessage(error),
            remediation: "check workspace permissions and free disk space",
          });
          continue;
        }
        try {
          const job = await createQueuedJob(
            normalized.kind,
            archiveFile.relative_path,
            normalized.sourceRef,
            archiveFile.id,
          );
          accepted.push({
            filename: name,
            job_id: job.id,
            status: job.status,
            source_path: archiveFile.relative_path,
            archive_file_id: archiveFile.id,
          });
        } catch (error) {
          rejected.push({ filename: name, error_code: "enqueue_failed", message: errorMessage(error) });
        }
      }

      return writeJson(c, accepted.length === 0 ? 400 : 201, { accepted, rejected });
    },

    async getIngestJob(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing job id");
      try {
        const job = await ctx.db.getIngestJob(id);
        if (!job) return writeError(c, 404, "job not found");
        return writeJson(c, 200, { job });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getIngestJobEvents(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing job id");
      try {
        const job = await ctx.db.getIngestJob(id);
        if (!job) return writeError(c, 404, "job not found");
        const limit = parseQueryInt(c, "limit", 500);
        return writeJson(c, 200, { events: await ctx.db.listIngestJobEvents(id, limit) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async listIngestJobs(c: Context): Promise<Response> {
      const limit = parseQueryInt(c, "limit", 50);
      try {
        return writeJson(c, 200, await ctx.db.listIngestJobs(limit));
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async retryIngestJob(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing job id");
      try {
        const job = await ctx.db.retryIngestJob(id);
        if (!job) return writeError(c, 404, "job not found");
        logIngestJob(ctx.db, job, "retried", "api");
        return writeJson(c, 200, { job });
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
    },

    async cancelIngestJob(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing job id");
      try {
        const job = await ctx.db.getIngestJob(id);
        if (!job) return writeError(c, 404, "job not found");
        const cancelled = await ctx.db.cancelIngestJob(id);
        if (cancelled) {
          const updated = await ctx.db.getIngestJob(id);
          if (updated) logIngestJob(ctx.db, updated, "cancelled", "api");
          return writeJson(c, 200, { status: "cancelled" });
        }
        const message =
          job.status === "running"
            ? "cancellation is not supported for current running stage"
            : "job cannot be cancelled in current status";
        return writeJson(c, 409, { status: job.status, message });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async markIngestJobFailed(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing job id");
      const req = await readJsonBody<{
        error_code?: string;
        message?: string;
        missing_dependency?: string;
        remediation?: string;
      }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (!(req.message ?? "").trim()) return writeError(c, 400, "message is required");
      try {
        await ctx.db.updateIngestJobFailure(
          id,
          (req.error_code ?? "").trim(),
          (req.message ?? "").trim(),
          (req.missing_dependency ?? "").trim(),
          (req.remediation ?? "").trim(),
        );
        const job = await ctx.db.getIngestJob(id);
        if (!job) return writeError(c, 404, "job not found");
        return writeJson(c, 200, { job });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getJobSource(c: Context): Promise<Response> {
      const denied = requireWorkspace(c);
      if (denied) return denied;
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing job id");
      let job;
      try {
        job = await ctx.db.getIngestJob(id);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
      if (!job) return writeError(c, 404, "job not found");
      if (job.archive_file_id) {
        try {
          const file = await ctx.db.getArchiveFile(job.archive_file_id);
          if (file) {
            const bytes = await new ArchiveStorageService(ctx.db, ctx.workspace).readFullBytes(file);
            const ext = path.extname(file.filename).toLowerCase();
            const imgType = IMAGE_SOURCE_EXTENSIONS[ext];
            if (imgType) {
              return c.body(new Uint8Array(bytes), 200, { "Content-Type": imgType });
            }
            if (TEXT_SOURCE_EXTENSIONS.has(ext) || file.kind === "markdown" || file.kind === "text") {
              return writeJson(c, 200, {
                content: new TextDecoder().decode(bytes),
                filename: file.filename,
                archive_file_id: file.id,
              });
            }
            return writeError(c, 400, "unsupported source file type for preview");
          }
        } catch (error) {
          return writeError(c, 500, errorMessage(error));
        }
      }
      const sourcePath = job.source_path.trim();
      if (!sourcePath) return writeError(c, 400, "job has no source path");
      if (sourcePath.includes("..")) {
        return writeError(c, 400, "source path contains invalid traversal components");
      }
      const root = path.resolve(ctx.workspace);
      const absPath = path.resolve(root, sourcePath);
      if (absPath !== root && !absPath.startsWith(`${root}${path.sep}`)) {
        return writeError(c, 400, "source path resolves outside workspace");
      }
      const ext = path.extname(sourcePath).toLowerCase();
      const contentType = IMAGE_SOURCE_EXTENSIONS[ext];
      if (contentType) {
        try {
          const data = await readFile(absPath);
          return c.body(new Uint8Array(data), 200, { "Content-Type": contentType });
        } catch {
          return writeError(c, 404, "source file not found");
        }
      }
      if (TEXT_SOURCE_EXTENSIONS.has(ext)) {
        try {
          const data = await readFile(absPath, "utf8");
          return writeJson(c, 200, { content: data, filename: path.basename(sourcePath) });
        } catch {
          return writeError(c, 404, "source file not found");
        }
      }
      return writeError(c, 400, "unsupported source file type for preview");
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
