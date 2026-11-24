import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
      // PostgreSQL is the SSOT; the workspace directory may only hold a stale
      // export. Materialize current documents so lint reports what the UI shows.
      let dir = "";
      try {
        dir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-lint-"));
        const docs = await ctx.db.listDocumentsWithContent();
        for (const doc of docs) {
          const rel = doc.relative_path;
          if (!rel) continue;
          const full = path.resolve(dir, rel);
          if (!full.startsWith(`${dir}${path.sep}`)) continue;
          await mkdir(path.dirname(full), { recursive: true });
          await writeFile(full, doc.content ?? "", "utf8");
        }
        const report = await lintWorkspace(dir);
        return writeJson(c, 200, { ...report, issues: report.issues ?? [] });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
