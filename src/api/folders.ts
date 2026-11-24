import type { Context } from "hono";
import { logDocument, record } from "../activity/index.js";
import { rebuildReferences } from "../ingest/dbapply.js";
import {
  FolderConflictError,
  FolderNotFoundError,
  FolderValidationError,
} from "../store/postgres/folders.js";
import type { FolderDeleteMode } from "../store/types.js";
import { readJsonBody, writeError, writeJson, type ApiContext } from "./context.js";

function mapFolderError(c: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof FolderValidationError) return writeError(c, 400, message);
  if (error instanceof FolderNotFoundError) return writeError(c, 404, message);
  if (error instanceof FolderConflictError) return writeError(c, 409, message);
  return writeError(c, 500, message);
}

export function foldersApi(ctx: ApiContext) {
  return {
    async getTree(c: Context): Promise<Response> {
      const excludeHidden = c.req.query("exclude_hidden") !== "false";
      const pageTypes = c.req.queries("types") ?? c.req.queries("type") ?? [];
      try {
        const [folders, documents] = await Promise.all([
          ctx.db.listFolders(excludeHidden),
          ctx.db.listDocumentsFiltered({
            source_kind: "wiki",
            exclude_hidden: excludeHidden,
            page_types: pageTypes,
          }),
        ]);
        return writeJson(c, 200, { folders, documents });
      } catch (error) {
        return mapFolderError(c, error);
      }
    },

    async listFolders(c: Context): Promise<Response> {
      const excludeHidden = c.req.query("exclude_hidden") !== "false";
      try {
        const folders = await ctx.db.listFolders(excludeHidden);
        return writeJson(c, 200, folders);
      } catch (error) {
        return mapFolderError(c, error);
      }
    },

    async createFolder(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        path?: string;
        display_name?: string;
        description?: string;
        sort_order?: number;
      }>(c);
      if (!req || !req.path) return writeError(c, 400, "path is required");
      try {
        const folder = await ctx.db.createFolder({
          path: req.path,
          display_name: req.display_name,
          description: req.description,
          sort_order: req.sort_order,
        });
        record(ctx.db, {
          level: "info",
          category: "folder",
          action: "created",
          message: `创建目录 ${folder.path}`,
          resourceType: "folder",
          resourceId: folder.path,
          source: "api",
        });
        return writeJson(c, 201, folder);
      } catch (error) {
        return mapFolderError(c, error);
      }
    },

    async updateFolder(c: Context): Promise<Response> {
      const req = await readJsonBody<{
        path?: string;
        display_name?: string;
        description?: string;
        sort_order?: number;
      }>(c);
      if (!req || !req.path) return writeError(c, 400, "path is required");
      try {
        const updated = await ctx.db.updateFolder(req.path, {
          display_name: req.display_name,
          description: req.description,
          sort_order: req.sort_order,
        });
        if (!updated) return writeError(c, 404, "folder not found");
        return writeJson(c, 200, updated);
      } catch (error) {
        return mapFolderError(c, error);
      }
    },

    async moveFolder(c: Context): Promise<Response> {
      const req = await readJsonBody<{ from_path?: string; to_path?: string }>(c);
      if (!req || !req.from_path || !req.to_path) {
        return writeError(c, 400, "from_path and to_path are required");
      }
      try {
        const result = await ctx.db.moveFolder(req.from_path, req.to_path, "api");
        const toRebuild = [...new Set([...result.moved_doc_paths, ...result.updated_link_paths])];
        if (toRebuild.length > 0) {
          await rebuildReferences(ctx.db, toRebuild).catch(() => undefined);
        }
        record(ctx.db, {
          level: "info",
          category: "folder",
          action: "moved",
          message: `移动目录 ${result.from_path} -> ${result.to_path}`,
          resourceType: "folder",
          resourceId: result.to_path,
          source: "api",
          details: {
            moved_folders: result.moved_folders,
            moved_documents: result.moved_documents,
            change_set_id: result.change_set_id,
          },
        });
        return writeJson(c, 200, result);
      } catch (error) {
        return mapFolderError(c, error);
      }
    },

    async deleteFolder(c: Context): Promise<Response> {
      const folderPath = (c.req.query("path") ?? "").trim();
      if (!folderPath) return writeError(c, 400, "query parameter 'path' is required");
      const rawMode = (c.req.query("mode") ?? "empty").trim();
      if (rawMode !== "empty" && rawMode !== "move_to_parent" && rawMode !== "cascade") {
        return writeError(c, 400, "mode must be empty, move_to_parent, or cascade");
      }
      const targetFolder = (c.req.query("target_folder") ?? "").trim();
      try {
        const result = await ctx.db.deleteFolder(
          folderPath,
          rawMode as FolderDeleteMode,
          targetFolder,
          "api",
        );
        logDocument(ctx.db, "folder_deleted", folderPath, `wiki/${result.path}`, "api");
        return writeJson(c, 200, result);
      } catch (error) {
        return mapFolderError(c, error);
      }
    },
  };
}
