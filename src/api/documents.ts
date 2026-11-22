import path from "node:path";
import type { Context } from "hono";
import { record, logDocument } from "../activity/index.js";
import type { Document } from "../store/types.js";
import {
  applyPageDelete,
  applyPageDeletes,
  applyPageWrite,
  buildReferencesPayload,
  contentHash,
  docRelativePath,
  getID,
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

interface CreateDocumentRequest {
  filename?: string;
  path?: string;
  content?: string;
  title?: string;
  tags?: string[];
}

interface UpdateContentRequest {
  content?: string;
}

interface UpdateMetadataRequest {
  title?: string;
  tags?: string[];
  date?: string;
  metadata?: string;
}

interface BulkDeleteRequest {
  ids?: string[];
}

async function withPageLock<T>(ctx: ApiContext, relPath: string, fn: () => Promise<T>): Promise<T> {
  if (!ctx.lockMgr || !relPath) return fn();
  const release = await ctx.lockMgr.lock(relPath);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function documentsApi(ctx: ApiContext) {
  return {
    async listDocuments(c: Context): Promise<Response> {
      const filter = {
        source_kind: c.req.query("source_kind") ?? "",
        page_types: c.req.queries("types") ?? c.req.queries("type") ?? [],
        exclude_hidden: c.req.query("exclude_hidden") === "true",
      };
      try {
        const docs = await ctx.db.listDocumentsFiltered(filter);
        return writeJson(c, 200, docs);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getDocument(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      try {
        const doc = await ctx.db.getDocument(id);
        if (!doc) return writeError(c, 404, "document not found");
        const refs = await buildReferencesPayload(ctx.db, doc);
        return writeJson(c, 200, { ...doc, ...refs });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getDocumentContent(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      try {
        const doc = await ctx.db.getDocument(id);
        if (!doc) return writeError(c, 404, "document not found");
        return writeJson(c, 200, { content: doc.content });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async createDocument(c: Context): Promise<Response> {
      const req = await readJsonBody<CreateDocumentRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (!req.filename) return writeError(c, 400, "filename is required");

      const relPath = path.posix.join("/", req.path ?? "", req.filename).replace(/^\/+/, "");
      const sourceKind = relPath.startsWith("wiki/") ? "wiki" : "source";
      let dir = path.posix.dirname(`/${relPath}`);
      if (!dir.endsWith("/")) dir += "/";

      const doc: Document = {
        id: "",
        user_id: "",
        filename: path.posix.basename(relPath),
        title: req.title ?? "",
        path: dir,
        relative_path: relPath,
        source_kind: sourceKind,
        file_type: path.extname(relPath).replace(/^\./, ""),
        file_size: 0,
        document_number: 0,
        status: "ready",
        page_count: 0,
        content: req.content ?? "",
        tags: req.tags ?? [],
        date: "",
        metadata: "",
        error_message: "",
        version: 0,
        parser: "",
        content_hash: contentHash(req.content ?? ""),
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
      };

      try {
        await withPageLock(ctx, doc.relative_path, () =>
          applyPageWrite(ctx, "manual", "create page", doc, "create"),
        );
        const saved = await ctx.db.getDocument(doc.id);
        if (saved) Object.assign(doc, saved);
        logDocument(ctx.db, "created", doc.id, doc.relative_path, "api");
        return writeJson(c, 201, doc);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async updateDocumentContent(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      const req = await readJsonBody<UpdateContentRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");

      try {
        const doc = await ctx.db.getDocument(id);
        if (!doc) return writeError(c, 404, "document not found");
        doc.content = req.content ?? "";
        doc.content_hash = contentHash(doc.content);
        await withPageLock(ctx, doc.relative_path, () =>
          applyPageWrite(ctx, "manual", "update page content", doc, "update"),
        );
        const updated = await ctx.db.getDocument(id);
        logDocument(ctx.db, "updated", id, doc.relative_path, "api");
        return writeJson(c, 200, updated);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async updateDocumentMetadata(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      const req = await readJsonBody<UpdateMetadataRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");

      try {
        const existing = await ctx.db.getDocument(id);
        if (!existing) return writeError(c, 404, "document not found");
        existing.title = req.title || existing.title;
        existing.tags = req.tags ?? existing.tags;
        existing.date = req.date || existing.date;
        existing.metadata = req.metadata || existing.metadata;
        await applyPageWrite(ctx, "manual", "update page metadata", existing, "update");
        const doc = await ctx.db.getDocument(id);
        logDocument(ctx.db, "updated", id, existing.relative_path, "api");
        return writeJson(c, 200, doc);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async deleteDocument(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      try {
        const doc = await ctx.db.getDocument(id);
        if (!doc) return writeError(c, 404, "document not found");
        const relPath = docRelativePath(doc);
        await applyPageDelete(ctx, "manual", "delete page", relPath);
        logDocument(ctx.db, "deleted", id, relPath, "api");
        return writeJson(c, 200, { status: "deleted", path: relPath.replace(/^\/+/, "") });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async bulkDeleteDocuments(c: Context): Promise<Response> {
      const req = await readJsonBody<BulkDeleteRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (!req.ids?.length) return writeError(c, 400, "ids array is required");

      const relPaths: string[] = [];
      for (const id of req.ids) {
        try {
          const doc = await ctx.db.getDocument(id);
          if (!doc) continue;
          const rel = docRelativePath(doc);
          if (rel) relPaths.push(rel);
        } catch {
          continue;
        }
      }
      try {
        await applyPageDeletes(ctx, "manual", "bulk delete", relPaths);
        const deleted = relPaths.length;
        record(ctx.db, {
          level: "info",
          category: "document",
          action: "bulk_deleted",
          message: `批量删除 ${deleted} 个文档`,
          source: "api",
          details: { deleted_count: deleted, ids: req.ids },
        });
        return writeJson(c, 200, { deleted });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
