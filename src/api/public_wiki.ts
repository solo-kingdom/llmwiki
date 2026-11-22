import type { Context } from "hono";
import type { Document, SearchChunk } from "../store/types.js";
import {
  buildReferencesPayload,
  getID,
  parseQueryInt,
  requirePublicWiki,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

function toPublicListItem(doc: Document) {
  return {
    id: doc.id,
    filename: doc.filename,
    title: doc.title,
    path: doc.path,
    relative_path: doc.relative_path,
    source_kind: doc.source_kind,
    page_type: doc.page_type ?? "",
    file_type: doc.file_type,
    page_count: doc.page_count,
    updated_at: doc.updated_at,
  };
}

function toPublicDocument(doc: Document) {
  return {
    id: doc.id,
    filename: doc.filename,
    title: doc.title,
    path: doc.path,
    file_type: doc.file_type,
    page_count: doc.page_count,
    updated_at: doc.updated_at,
    content: doc.content,
    tags: doc.tags ?? [],
  };
}

function toPublicSearchResult(chunk: SearchChunk) {
  return {
    document_id: chunk.document_id,
    content: chunk.content,
    page: chunk.page,
    header_breadcrumb: chunk.header_breadcrumb,
    chunk_index: chunk.chunk_index,
    filename: chunk.filename,
    title: chunk.title,
    path: chunk.path,
    file_type: chunk.file_type,
    score: chunk.score,
  };
}

export function publicWikiApi(ctx: ApiContext) {
  return {
    async publicWikiStatus(c: Context): Promise<Response> {
      return writeJson(c, 200, { enabled: ctx.publicWikiEnabled });
    },

    async listPublicWikiDocuments(c: Context): Promise<Response> {
      const denied = requirePublicWiki(ctx, c);
      if (denied) return denied;
      try {
        const docs = await ctx.db.listDocumentsFiltered({
          source_kind: "wiki",
          exclude_hidden: true,
        });
        return writeJson(c, 200, docs.map(toPublicListItem));
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getPublicWikiDocument(c: Context): Promise<Response> {
      const denied = requirePublicWiki(ctx, c);
      if (denied) return denied;
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      try {
        const doc = await ctx.db.getDocument(id);
        if (!doc) return writeError(c, 404, "document not found");
        const refs = await buildReferencesPayload(ctx.db, doc);
        return writeJson(c, 200, { ...toPublicDocument(doc), ...refs });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async searchPublicWiki(c: Context): Promise<Response> {
      const denied = requirePublicWiki(ctx, c);
      if (denied) return denied;
      const query = c.req.query("q") ?? "";
      if (!query) return writeError(c, 400, "query parameter 'q' is required");
      const limit = parseQueryInt(c, "limit", 10);
      const filter = c.req.query("filter") || "wiki";
      const pageTypes = c.req.queries("types") ?? [];
      try {
        const results = await ctx.db.searchChunks(query, limit, filter, pageTypes);
        return writeJson(c, 200, { query, results: results.map(toPublicSearchResult) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
