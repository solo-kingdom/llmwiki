import type { Context } from "hono";
import { buildDeterministicClusterPlan, detectOvercrowdedFolders } from "../engine/auto_cluster.js";
import { readJsonBody, writeError, writeJson, type ApiContext } from "./context.js";

export function organizeApi(ctx: ApiContext) {
  return {
    async listOvercrowdedFolders(c: Context): Promise<Response> {
      const wikiThreshold = Number.parseInt(c.req.query("wiki_threshold") ?? "20", 10);
      const archiveThreshold = Number.parseInt(c.req.query("archive_threshold") ?? "30", 10);
      try {
        const items = await detectOvercrowdedFolders(ctx.db, {
          wikiThreshold: Number.isFinite(wikiThreshold) ? wikiThreshold : 20,
          archiveThreshold: Number.isFinite(archiveThreshold) ? archiveThreshold : 30,
        });
        return writeJson(c, 200, { overcrowded: items });
      } catch (error) {
        return writeError(c, 500, error instanceof Error ? error.message : String(error));
      }
    },

    async generateAutoClusterPlan(c: Context): Promise<Response> {
      const req = (await readJsonBody<{ folder?: string; min_cluster_size?: number }>(c)) ?? {};
      const folder = (req.folder ?? "").trim();
      if (!folder) return writeError(c, 400, "folder is required");
      try {
        const docs = await ctx.db.listDocumentsWithContent();
        const plan = buildDeterministicClusterPlan(docs, folder, {
          minClusterSize: req.min_cluster_size ?? 3,
        });
        return writeJson(c, 200, plan);
      } catch (error) {
        return writeError(c, 500, error instanceof Error ? error.message : String(error));
      }
    },
  };
}
