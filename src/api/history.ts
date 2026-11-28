import type { Context } from "hono";
import { logIngestJob, record } from "../activity/index.js";
import { rebuildDerived } from "../ingest/rebuild.js";
import {
  HISTORY_LIST_DEFAULT_LIMIT,
  clampHistoryListLimit,
  clampHistoryListOffset,
  parseHistoryKindFilter,
  parseHistoryTimeBound,
  validateHistoryTimeRange,
  type ChangeSetListFilter,
} from "../store/history_list.js";
import type { IngestJob } from "../store/types.js";
import {
  getID,
  parseQueryInt,
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";
import { unifiedDiff } from "./diff.js";

export function historyApi(ctx: ApiContext) {
  async function enqueueRollback(c: Context, changeSetId: string): Promise<Response> {
    if (!changeSetId) return writeError(c, 400, "change_set_id is required");
    try {
      const changeSet = await ctx.db.getChangeSet(changeSetId);
      if (!changeSet) return writeError(c, 404, "change set not found");
      const existing = await ctx.db.getIngestJobBySourceRef(changeSetId, "rollback");
      if (existing && existing.status === "queued") {
        return writeJson(c, 202, { status: "rollback_queued", job_id: existing.id });
      }
      const job: IngestJob = {
        id: "",
        parent_job_id: "",
        input_type: "rollback",
        source_path: "",
        source_ref: changeSetId,
        status: "queued",
        retries: 0,
        max_retries: 1,
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
      logIngestJob(ctx.db, job, "queued", "api");
      return writeJson(c, 202, { status: "rollback_queued", job_id: job.id });
    } catch (error) {
      return writeError(c, 500, errorMessage(error));
    }
  }

  return {
    async listHistory(c: Context): Promise<Response> {
      let kinds: string[];
      let from: string;
      let to: string;
      let before: string;
      try {
        kinds = parseHistoryKindFilter(c.req.query("kind") ?? "");
        from = parseHistoryTimeBound(c.req.query("from") ?? "", "from");
        to = parseHistoryTimeBound(c.req.query("to") ?? "", "to");
        before = parseHistoryTimeBound(c.req.query("before") ?? "", "before");
        validateHistoryTimeRange(from, to);
      } catch (error) {
        return writeError(c, 400, errorMessage(error));
      }
      const filter: ChangeSetListFilter = {
        kinds,
        query: (c.req.query("q") ?? "").trim(),
        from,
        to,
        before,
        limit: clampHistoryListLimit(parseQueryInt(c, "limit", HISTORY_LIST_DEFAULT_LIMIT)),
        offset: clampHistoryListOffset(parseQueryInt(c, "offset", 0)),
      };
      try {
        return writeJson(c, 200, await ctx.db.listChangeSets(filter));
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getHistory(c: Context): Promise<Response> {
      const id = getID(c);
      try {
        const changeSet = await ctx.db.getChangeSet(id);
        if (!changeSet) return writeError(c, 404, "change set not found");
        const pages = await ctx.db.listChangeSetRevisions(id);
        return writeJson(c, 200, { change_set: changeSet, pages });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async historyDiff(c: Context): Promise<Response> {
      const id = getID(c);
      try {
        const changeSet = await ctx.db.getChangeSet(id);
        if (!changeSet) return writeError(c, 404, "change set not found");
        const revisions = await ctx.db.listChangeSetRevisions(id);
        let diffText = "";
        for (const revision of revisions) {
          let before = "";
          let from = "/dev/null";
          let fromName = `a/${revision.relative_path}`;
          if (revision.parent_revision_id) {
            const parent = await ctx.db.getRevision(revision.parent_revision_id);
            if (parent) {
              before = parent.content;
              from = `a/${parent.relative_path}`;
              fromName = from;
            }
          }
          diffText += `diff --git ${fromName} b/${revision.relative_path}\n`;
          diffText += unifiedDiff(before, revision.content, {
            fromFile: from,
            toFile: `b/${revision.relative_path}`,
            context: 3,
          });
        }
        return writeJson(c, 200, { diff: diffText });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    rollbackHistory: (c: Context) => enqueueRollback(c, getID(c)),

    async ingestRollback(c: Context): Promise<Response> {
      const req = await readJsonBody<{ change_set_id?: string }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      return enqueueRollback(c, (req.change_set_id ?? "").trim());
    },

    async pageHistory(c: Context): Promise<Response> {
      const docId = (c.req.query("document_id") ?? "").trim();
      const rel = (c.req.query("path") ?? "").trim().replace(/^\/+/, "");
      const key = docId || rel;
      if (!key) return writeError(c, 400, "query parameter 'path' or 'document_id' is required");
      const limit = parseQueryInt(c, "limit", 100);
      try {
        const revisions = await ctx.db.listPageRevisions(key, limit);
        return writeJson(c, 200, { path: rel || key, revisions });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getRevision(c: Context): Promise<Response> {
      try {
        const revision = await ctx.db.getRevision(getID(c));
        if (!revision) return writeError(c, 404, "revision not found");
        return writeJson(c, 200, revision);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async restoreRevision(c: Context): Promise<Response> {
      try {
        const changeSet = await ctx.db.restoreRevision(getID(c), "api");
        await rebuildDerived(ctx.db);
        record(ctx.db, {
          level: "info",
          category: "revision",
          action: "revision_restored",
          message: `恢复版本 ${getID(c)}`,
          resourceType: "revision",
          resourceId: getID(c),
          status: "success",
          source: "api",
        });
        return writeJson(c, 201, changeSet);
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
