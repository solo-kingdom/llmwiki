import type { Context } from "hono";
import { lintWorkspace } from "../engine/lint.js";
import { getID, parseQueryInt, writeError, writeJson, type ApiContext } from "./context.js";

export function graphApi(ctx: ApiContext) {
  return {
    async knowledgeGraph(c: Context): Promise<Response> {
      let limit = parseQueryInt(c, "limit", 300);
      if (limit <= 0) limit = 300;
      if (limit > 10000) limit = 10000;
      try {
        const data = await ctx.db.buildKnowledgeGraph(limit);
        return writeJson(c, 200, {
          nodes: data.nodes ?? [],
          edges: data.edges ?? [],
          total_nodes: data.total_nodes,
          truncated: data.truncated,
        });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async backlinks(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      try {
        return writeJson(c, 200, await ctx.db.getBacklinks(id));
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async forwardReferences(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "missing document id");
      try {
        return writeJson(c, 200, await ctx.db.getForwardReferences(id));
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async uncitedSources(c: Context): Promise<Response> {
      try {
        return writeJson(c, 200, await ctx.db.findUncitedSources());
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async stalePages(c: Context): Promise<Response> {
      try {
        return writeJson(c, 200, await ctx.db.findStalePages());
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

export function lintApi(ctx: ApiContext) {
  return {
    async lint(c: Context): Promise<Response> {
      if (!ctx.workspace) return writeError(c, 400, "workspace not configured");
      try {
        const report = await lintWorkspace(ctx.workspace);
        return writeJson(c, 200, { ...report, issues: report.issues ?? [] });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
