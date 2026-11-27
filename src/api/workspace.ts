import type { Context } from "hono";
import { PAGE_TYPE_TO_WIKI_SUBDIR, WIKI_SYSTEM_SUBDIRS, isWikiSystemPath, wikiPageType } from "../engine/wiki_org.js";
import { CONFIG_WORKSPACE_PURPOSE, CONFIG_WORKSPACE_RULES } from "../ingest/prompts.js";
import { todayIsoDate } from "../store/postgres/doc_meta.js";
import type { Document } from "../store/types.js";
import {
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

interface WorkspaceLayout {
  purpose: boolean;
  rules: boolean;
  wiki: boolean;
  raw_sources: boolean;
  index_db: boolean;
}

interface WorkspaceCounts {
  documents: number;
  wiki_pages: number;
  sources: number;
}

interface WorkspaceDir {
  dir: string;
  count: number;
}

interface WorkspaceLifecycle {
  active: number;
  archived: number;
  draft: number;
  validated: number;
  deprecated: number;
  review_overdue: number;
}

interface WorkspaceOverview {
  root: string;
  layout: WorkspaceLayout;
  counts: WorkspaceCounts;
  page_types: Record<string, number>;
  wiki_dirs: WorkspaceDir[];
  lifecycle?: WorkspaceLifecycle;
  last_updated?: string;
}

function sortDirs(dirs: WorkspaceDir[]): WorkspaceDir[] {
  return dirs.sort((a, b) => {
    if (a.dir === "") return -1;
    if (b.dir === "") return 1;
    return a.dir.localeCompare(b.dir);
  });
}

function wikiDirsFromDocuments(docs: Document[]): WorkspaceDir[] {
  const counts: Record<string, number> = {};
  for (const doc of docs) {
    if (doc.source_kind !== "wiki") continue;
    const rel = doc.relative_path.replace(/^wiki\//, "");
    const lastSlash = rel.lastIndexOf("/");
    if (lastSlash < 0) {
      counts[""] = (counts[""] ?? 0) + 1;
      continue;
    }
    const dir = rel.slice(0, lastSlash);
    const top = dir.split("/")[0] ?? "";
    if (WIKI_SYSTEM_SUBDIRS.has(top)) continue;
    counts[dir] = (counts[dir] ?? 0) + 1;
  }
  return sortDirs(Object.entries(counts).map(([name, count]) => ({ dir: name, count })));
}

function businessPageTypes(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pageType of Object.keys(PAGE_TYPE_TO_WIKI_SUBDIR)) out[pageType] = 0;
  return out;
}

export function workspaceApi(ctx: ApiContext) {
  return {
    async getWorkspace(c: Context): Promise<Response> {
      const overview: WorkspaceOverview = {
        root: ctx.workspace || "postgresql",
        layout: {
          purpose: false,
          rules: false,
          wiki: false,
          raw_sources: false,
          index_db: Boolean(ctx.db),
        },
        counts: { documents: 0, wiki_pages: 0, sources: 0 },
        page_types: businessPageTypes(),
        wiki_dirs: [],
      };

      try {
        const [docs, purposeCfg, rulesCfg, archiveFiles] = await Promise.all([
          ctx.db.listDocumentsFiltered({ archived: "include" }),
          ctx.db.getConfig(CONFIG_WORKSPACE_PURPOSE).catch(() => ""),
          ctx.db.getConfig(CONFIG_WORKSPACE_RULES).catch(() => ""),
          typeof ctx.db.listArchiveFiles === "function"
            ? ctx.db.listArchiveFiles().catch(() => [])
            : Promise.resolve([]),
        ]);
        overview.layout.purpose = Boolean(purposeCfg.trim());
        overview.layout.rules = Boolean(rulesCfg.trim());

        const today = todayIsoDate();
        const lifecycle: WorkspaceLifecycle = {
          active: 0,
          archived: 0,
          draft: 0,
          validated: 0,
          deprecated: 0,
          review_overdue: 0,
        };
        for (const doc of docs) {
          overview.counts.documents += 1;
          if (doc.source_kind === "wiki") {
            overview.counts.wiki_pages += 1;
            const pageType = doc.page_type || wikiPageType(doc.relative_path);
            if (!doc.archived_at && PAGE_TYPE_TO_WIKI_SUBDIR[pageType]) {
              overview.page_types[pageType] = (overview.page_types[pageType] ?? 0) + 1;
            }
            if (!isWikiSystemPath(doc.relative_path)) {
              if (doc.archived_at) lifecycle.archived += 1;
              else lifecycle.active += 1;
              if (doc.page_status === "draft") lifecycle.draft += 1;
              else if (doc.page_status === "validated") lifecycle.validated += 1;
              else if (doc.page_status === "deprecated") lifecycle.deprecated += 1;
              if (!doc.archived_at && doc.review_after && doc.review_after < today) {
                lifecycle.review_overdue += 1;
              }
            }
          } else if (doc.source_kind === "source") {
            overview.counts.sources += 1;
          }
          if (doc.updated_at > (overview.last_updated ?? "")) overview.last_updated = doc.updated_at;
        }
        overview.layout.wiki = overview.counts.wiki_pages > 0;
        overview.layout.raw_sources = overview.counts.sources > 0 || archiveFiles.length > 0;
        overview.wiki_dirs = wikiDirsFromDocuments(docs.filter((d) => !d.archived_at));
        overview.lifecycle = lifecycle;
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
      return writeJson(c, 200, overview);
    },

    async getWorkspaceRuleFiles(c: Context): Promise<Response> {
      try {
        const [purpose, rules] = await Promise.all([
          ctx.db.getConfig(CONFIG_WORKSPACE_PURPOSE).catch(() => ""),
          ctx.db.getConfig(CONFIG_WORKSPACE_RULES).catch(() => ""),
        ]);
        const purposeText = purpose.trim();
        const rulesText = rules.trim();
        return writeJson(c, 200, {
          purpose: purposeText,
          rules: rulesText,
          purpose_preview: purposeText,
          rules_preview: rulesText,
        });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async updateWorkspaceRuleFiles(c: Context): Promise<Response> {
      const req = await readJsonBody<{ purpose?: string; rules?: string }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      if (req.purpose === undefined && req.rules === undefined) {
        return writeError(c, 400, "purpose or rules is required");
      }
      const written: string[] = [];
      for (const [key, label, content] of [
        [CONFIG_WORKSPACE_PURPOSE, "purpose.md", req.purpose],
        [CONFIG_WORKSPACE_RULES, "rules.md", req.rules],
      ] as const) {
        if (content === undefined) continue;
        if (!content.trim()) return writeError(c, 400, `${label}: content must not be empty`);
        await ctx.db.setConfig(key, content);
        written.push(label);
      }
      return writeJson(c, 200, { status: "ok", written });
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
