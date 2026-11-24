import path from "node:path";
import type { Context } from "hono";
import { record, logDocument } from "../activity/index.js";
import { parseFrontmatter, upsertFrontmatterType } from "../engine/frontmatter.js";
import {
  isValidPageType,
  resolvePageType,
  validateWikiWritePath,
} from "../engine/wiki_org.js";
import { rebuildReferences } from "../ingest/dbapply.js";
import {
  FolderConflictError,
  FolderNotFoundError,
  FolderValidationError,
} from "../store/postgres/folders.js";
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
  page_type?: string;
}

interface UpdateContentRequest {
  content?: string;
}

interface UpdateMetadataRequest {
  title?: string;
  tags?: string[];
  date?: string;
  metadata?: string;
  page_type?: string;
}

interface MoveDocumentRequest {
  target_folder?: string;
  filename?: string;
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
      if (sourceKind === "wiki") {
        try {
          validateWikiWritePath(relPath);
        } catch (error) {
          return writeError(c, 400, errorMessage(error));
        }
      }
      if (req.page_type && !isValidPageType(req.page_type)) {
        return writeError(c, 400, `invalid page_type: ${req.page_type}`);
      }
      let dir = path.posix.dirname(`/${relPath}`);
      if (!dir.endsWith("/")) dir += "/";

      const fm = parseFrontmatter(req.content ?? "");
      const resolvedPageType =
        sourceKind === "wiki"
          ? resolvePageType(fm.type, req.page_type ?? "", relPath)
          : "";
      const initialContent =
        sourceKind === "wiki" && req.page_type && !fm.type
          ? upsertFrontmatterType(req.content ?? "", resolvedPageType)
          : (req.content ?? "");

      const doc: Document = {
        id: "",
        user_id: "",
        filename: path.posix.basename(relPath),
        title: req.title || fm.title || "",
        path: dir,
        relative_path: relPath,
        source_kind: sourceKind,
        file_type: path.extname(relPath).replace(/^\./, ""),
        file_size: 0,
        document_number: 0,
        status: "ready",
        page_count: 0,
        content: initialContent,
        tags: req.tags ?? fm.tags ?? [],
        date: fm.date || "",
        metadata: "",
        error_message: "",
        version: 0,
        parser: "",
        content_hash: contentHash(initialContent),
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
        page_type: resolvedPageType,
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
        if (doc.source_kind === "wiki") {
          const fm = parseFrontmatter(doc.content);
          if (fm.type) {
            doc.page_type = resolvePageType(fm.type, doc.page_type ?? "", doc.relative_path);
          }
        }
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
        if (req.page_type !== undefined) {
          if (!isValidPageType(req.page_type)) {
            return writeError(c, 400, `invalid page_type: ${req.page_type}`);
          }
          const cleanType = req.page_type.trim().toLowerCase();
          existing.page_type = cleanType;
          if (existing.source_kind === "wiki") {
            existing.content = upsertFrontmatterType(existing.content ?? "", cleanType);
          }
        }
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

    async moveDocument(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      const req = await readJsonBody<MoveDocumentRequest>(c);
      if (!req || !req.target_folder) {
        return writeError(c, 400, "target_folder is required");
      }
      try {
        const result = await ctx.db.moveDocument(id, req.target_folder, req.filename, "api");
        const toRebuild = [
          result.document.relative_path,
          ...result.updated_link_paths,
        ].filter(Boolean);
        if (toRebuild.length > 0) {
          await rebuildReferences(ctx.db, [...new Set(toRebuild)]).catch(() => undefined);
        }
        logDocument(ctx.db, "moved", id, result.document.relative_path, "api");
        return writeJson(c, 200, {
          document: result.document,
          old_relative_path: result.old_relative_path,
          change_set_id: result.change_set_id,
          updated_link_count: result.updated_link_paths.length,
        });
      } catch (error) {
        if (error instanceof FolderValidationError) return writeError(c, 400, error.message);
        if (error instanceof FolderNotFoundError) return writeError(c, 404, error.message);
        if (error instanceof FolderConflictError) return writeError(c, 409, error.message);
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
