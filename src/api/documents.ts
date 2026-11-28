import path from "node:path";
import type { Context } from "hono";
import { record, logDocument } from "../activity/index.js";
import {
  ArchiveValidationError,
  buildArchivedDocument,
  buildReopenedDocument,
} from "../engine/archive.js";
import {
  isValidIsoDate,
  parseFrontmatter,
  upsertFrontmatterFields,
} from "../engine/frontmatter.js";
import {
  isValidConfidence,
  isValidExperienceKind,
  isValidExperienceStatus,
  isValidPageType,
  isWikiSystemPath,
  RESERVED_TOP_LEVEL_WIKI_PAGES,
  resolvePageType,
  validateWikiWritePath,
} from "../engine/wiki_org.js";
import { rebuildReferences } from "../ingest/dbapply.js";
import {
  FolderConflictError,
  FolderNotFoundError,
  FolderValidationError,
} from "../store/postgres/folders.js";
import { syncDocumentMetaFromContent } from "../store/postgres/doc_meta.js";
import type { ArchiveFilter, Document } from "../store/types.js";
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
  confidence?: string;
  page_status?: string;
  experience_kind?: string;
  last_verified?: string;
  review_after?: string;
  aliases?: string[];
  symptoms?: string[];
}

interface ArchiveDocumentRequest {
  reason?: string;
  superseded_by?: string;
  date?: string;
}

interface ReopenDocumentRequest {
  reason?: string;
  confidence?: string;
  last_verified?: string;
  review_after?: string;
  date?: string;
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
      const rawArchived = (c.req.query("archived") ?? "").trim().toLowerCase();
      const archived: ArchiveFilter =
        rawArchived === "include" || rawArchived === "only" || rawArchived === "exclude"
          ? rawArchived
          : c.req.query("include_archived") === "true"
            ? "include"
            : "exclude";
      const folder = (c.req.query("folder") ?? "").trim();
      const tags = c.req.queries("tags") ?? c.req.queries("tag") ?? [];
      const tagMode = (c.req.query("tag_mode") ?? "").trim().toLowerCase() === "all" ? "all" : "any";
      const updatedAfter = (c.req.query("updated_after") ?? "").trim();
      const updatedBefore = (c.req.query("updated_before") ?? "").trim();
      const paginated = c.req.query("paginated") === "true";
      const rawLimit = Number.parseInt(c.req.query("limit") ?? "", 10);
      const rawOffset = Number.parseInt(c.req.query("offset") ?? "", 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : undefined;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

      const filter = {
        source_kind: c.req.query("source_kind") ?? "",
        page_types: c.req.queries("types") ?? c.req.queries("type") ?? [],
        exclude_hidden: c.req.query("exclude_hidden") === "true",
        experience_kinds: c.req.queries("kinds") ?? c.req.queries("kind") ?? [],
        statuses: c.req.queries("statuses") ?? c.req.queries("status") ?? [],
        confidences: c.req.queries("confidences") ?? c.req.queries("confidence") ?? [],
        archived,
        review_overdue: c.req.query("review_overdue") === "true",
        ...(folder ? { folder } : {}),
        ...(tags.length > 0 ? { tags, tag_mode: tagMode as "any" | "all" } : {}),
        ...(updatedAfter ? { updated_after: updatedAfter } : {}),
        ...(updatedBefore ? { updated_before: updatedBefore } : {}),
        ...(!paginated && limit !== undefined ? { limit } : {}),
        ...(!paginated && offset > 0 ? { offset } : {}),
      };
      try {
        let docs = await ctx.db.listDocumentsFiltered(filter);
        // Apply folder/tag/date filtering in-memory too so mock stores in tests stay consistent
        if (folder) {
          const cleanFolder = folder.replace(/^\/+|\/+$/g, "").replace(/^wiki\//, "");
          if (cleanFolder) {
            docs = docs.filter((d) => d.relative_path.startsWith(`wiki/${cleanFolder}/`));
          }
        }
        if (tags.length > 0) {
          const wanted = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
          if (wanted.length > 0) {
            docs = docs.filter((d) => {
              const docTags = new Set((d.tags ?? []).map((t) => t.trim().toLowerCase()));
              return tagMode === "all"
                ? wanted.every((t) => docTags.has(t))
                : wanted.some((t) => docTags.has(t));
            });
          }
        }
        if (updatedAfter) {
          docs = docs.filter((d) => (d.updated_at || "") >= updatedAfter);
        }
        if (updatedBefore) {
          docs = docs.filter((d) => (d.updated_at || "") <= updatedBefore);
        }

        if (paginated) {
          const total = docs.length;
          const pageLimit = limit ?? 50;
          const items = docs.slice(offset, offset + pageLimit);
          return writeJson(c, 200, {
            items,
            total,
            limit: pageLimit,
            offset,
            has_more: offset + items.length < total,
          });
        }
        if (offset > 0 || limit !== undefined) {
          const end = limit !== undefined ? offset + limit : undefined;
          docs = docs.slice(offset, end);
        }
        return writeJson(c, 200, docs);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getDocumentByPath(c: Context): Promise<Response> {
      const rawPath = (c.req.query("path") ?? "").trim();
      if (!rawPath) return writeError(c, 400, "query parameter 'path' is required");
      const cleanPath = rawPath.replace(/^\/+/, "");
      const includeContent = c.req.query("include_content") !== "false";
      try {
        let doc = await ctx.db.getDocumentByRelativePath(cleanPath);
        if (!doc && !cleanPath.startsWith("wiki/")) {
          doc = await ctx.db.getDocumentByRelativePath(`wiki/${cleanPath}`);
        }
        if (!doc) return writeError(c, 404, "document not found");
        const [refs, archiveSources] = await Promise.all([
          buildReferencesPayload(ctx.db, doc),
          typeof ctx.db.listDocumentArchiveSources === "function"
            ? ctx.db.listDocumentArchiveSources(doc.id)
            : Promise.resolve([]),
        ]);
        const contentLength = [...(doc.content ?? "")].length;
        const payload = includeContent
          ? { ...doc, ...refs, archive_sources: archiveSources, content_length: contentLength }
          : { ...doc, content: "", ...refs, archive_sources: archiveSources, content_length: contentLength };
        return writeJson(c, 200, payload);
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
        const [refs, archiveSources] = await Promise.all([
          buildReferencesPayload(ctx.db, doc),
          typeof ctx.db.listDocumentArchiveSources === "function"
            ? ctx.db.listDocumentArchiveSources(doc.id)
            : Promise.resolve([]),
        ]);
        return writeJson(c, 200, { ...doc, ...refs, archive_sources: archiveSources });
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
          ? upsertFrontmatterFields(req.content ?? "", { type: resolvedPageType })
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

        const fmUpdates: Record<string, string | string[] | undefined> = {};
        if (req.page_type !== undefined) {
          if (!isValidPageType(req.page_type)) {
            return writeError(c, 400, `invalid page_type: ${req.page_type}`);
          }
          const cleanType = req.page_type.trim().toLowerCase();
          existing.page_type = cleanType;
          fmUpdates.type = cleanType;
        }
        if (req.confidence !== undefined) {
          const conf = req.confidence.trim().toLowerCase();
          if (conf && !isValidConfidence(conf)) {
            return writeError(c, 400, `invalid confidence: ${req.confidence}`);
          }
          existing.confidence = conf;
          fmUpdates.confidence = conf;
        }
        if (req.experience_kind !== undefined) {
          const kind = req.experience_kind.trim().toLowerCase();
          if (kind && !isValidExperienceKind(kind)) {
            return writeError(c, 400, `invalid experience_kind: ${req.experience_kind}`);
          }
          existing.experience_kind = kind;
          fmUpdates.kind = kind;
        }
        if (req.page_status !== undefined) {
          const status = req.page_status.trim().toLowerCase();
          if (existing.page_type === "experience" && status && !isValidExperienceStatus(status)) {
            return writeError(c, 400, `invalid experience status: ${req.page_status}`);
          }
          existing.page_status = status;
          fmUpdates.status = status;
        }
        if (req.last_verified !== undefined) {
          const lv = req.last_verified.trim();
          if (lv && !isValidIsoDate(lv)) {
            return writeError(c, 400, `invalid last_verified date: ${req.last_verified}`);
          }
          existing.last_verified = lv;
          fmUpdates.last_verified = lv;
        }
        if (req.review_after !== undefined) {
          const ra = req.review_after.trim();
          if (ra && !isValidIsoDate(ra)) {
            return writeError(c, 400, `invalid review_after date: ${req.review_after}`);
          }
          existing.review_after = ra;
          fmUpdates.review_after = ra;
        }
        if (req.aliases !== undefined) {
          existing.aliases = req.aliases.map((a) => a.trim()).filter(Boolean);
          fmUpdates.aliases = existing.aliases;
        }
        if (req.symptoms !== undefined) {
          existing.symptoms = req.symptoms.map((s) => s.trim()).filter(Boolean);
          fmUpdates.symptoms = existing.symptoms;
        }
        if (req.title) {
          existing.title = req.title;
          fmUpdates.title = req.title;
        }
        if (req.tags !== undefined) {
          existing.tags = req.tags;
          fmUpdates.tags = req.tags;
        }
        if (req.date) {
          existing.date = req.date;
          fmUpdates.date = req.date;
        }
        if (req.metadata) existing.metadata = req.metadata;

        if (existing.source_kind === "wiki" && Object.keys(fmUpdates).length > 0) {
          existing.content = upsertFrontmatterFields(existing.content ?? "", fmUpdates);
          syncDocumentMetaFromContent(existing);
        }
        await withPageLock(ctx, existing.relative_path, () =>
          applyPageWrite(ctx, "manual", "update page metadata", existing, "update"),
        );
        const doc = await ctx.db.getDocument(id);
        logDocument(ctx.db, "updated", id, existing.relative_path, "api");
        return writeJson(c, 200, doc);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async archiveDocument(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      const req = await readJsonBody<ArchiveDocumentRequest>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      try {
        const existing = await ctx.db.getDocument(id);
        if (!existing) return writeError(c, 404, "document not found");
        if (isSystemDocument(existing)) {
          return writeError(c, 400, `system page cannot be archived: ${existing.relative_path}`);
        }
        const archived = buildArchivedDocument(existing, {
          reason: req.reason ?? "",
          supersededBy: req.superseded_by,
          date: req.date,
        });
        await withPageLock(ctx, existing.relative_path, () =>
          applyPageWrite(ctx, "manual", `archive page: ${archived.archive_reason}`, archived, "archive"),
        );
        const doc = await ctx.db.getDocument(id);
        logDocument(ctx.db, "archived", id, existing.relative_path, "api");
        return writeJson(c, 200, doc);
      } catch (error) {
        if (error instanceof ArchiveValidationError) return writeError(c, 400, error.message);
        return writeError(c, 500, errorMessage(error));
      }
    },

    async reopenDocument(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      const req = (await readJsonBody<ReopenDocumentRequest>(c)) ?? {};
      try {
        const existing = await ctx.db.getDocument(id);
        if (!existing) return writeError(c, 404, "document not found");
        const reopened = buildReopenedDocument(existing, {
          reason: req.reason,
          confidence: req.confidence,
          lastVerified: req.last_verified,
          reviewAfter: req.review_after,
          date: req.date,
        });
        await withPageLock(ctx, existing.relative_path, () =>
          applyPageWrite(ctx, "manual", "reopen page", reopened, "reopen"),
        );
        const doc = await ctx.db.getDocument(id);
        logDocument(ctx.db, "reopened", id, existing.relative_path, "api");
        return writeJson(c, 200, doc);
      } catch (error) {
        if (error instanceof ArchiveValidationError) return writeError(c, 400, error.message);
        return writeError(c, 500, errorMessage(error));
      }
    },

    async moveDocument(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      const req = await readJsonBody<MoveDocumentRequest>(c);
      if (!req || typeof req.target_folder !== "string") {
        return writeError(c, 400, "target_folder is required (empty string for the wiki root)");
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
        if (isSystemDocument(doc)) {
          return writeError(c, 400, `system page cannot be deleted: ${doc.relative_path}`);
        }
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
          if (isSystemDocument(doc)) {
            return writeError(c, 400, `system page cannot be deleted: ${doc.relative_path}`);
          }
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

function isSystemDocument(doc: Document): boolean {
  return RESERVED_TOP_LEVEL_WIKI_PAGES.has(doc.relative_path) || isWikiSystemPath(doc.relative_path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
