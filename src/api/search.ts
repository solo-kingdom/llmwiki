import type { Context } from "hono";
import { embeddingClient } from "../llm/embeddings.js";
import { ArchiveValidationError } from "../store/postgres/archives.js";
import { SearchValidationError, validateSearchRegex } from "../store/postgres/chunks.js";
import type {
  ArchiveFilter,
  ArchiveSearchHit,
  ArchiveSearchOptions,
  SearchChunk,
  SearchMatchMode,
  SearchOptions,
  SearchSortMode,
} from "../store/types.js";
import { writeError, writeJson, type ApiContext } from "./context.js";

const VALID_SEARCH_SCOPES = new Set(["wiki", "archives", "all"]);
const VALID_MATCH_MODES = new Set<SearchMatchMode>(["fuzzy", "all_terms", "phrase", "regex"]);
const VALID_SORT_MODES = new Set<SearchSortMode>(["relevance", "updated_desc", "updated_asc"]);

export interface HybridSearchResult {
  results: SearchChunk[];
  effectiveMode: string;
  degradedReason?: string;
}

export function normalizeSearchMode(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case "keyword":
    case "semantic":
    case "hybrid":
      return raw.trim().toLowerCase();
    default:
      return "auto";
  }
}

export function markMatchType(results: SearchChunk[], kind: string): SearchChunk[] {
  return results.map((result) => ({ ...result, match_type: kind }));
}

export function fuseSearch(keyword: SearchChunk[], semantic: SearchChunk[], limit: number): SearchChunk[] {
  const k = 60;
  interface Entry {
    result: SearchChunk;
    score: number;
    order: number;
  }
  const merged = new Map<string, Entry>();
  const add = (results: SearchChunk[], kind: string) => {
    results.forEach((result, rank) => {
      const tagged = { ...result, match_type: kind };
      let entry = merged.get(result.document_id);
      if (!entry) {
        entry = { result: tagged, score: 0, order: merged.size };
        merged.set(result.document_id, entry);
      }
      entry.score += 1 / (k + rank + 1);
    });
  };
  add(keyword, "keyword");
  add(semantic, "semantic");
  const entries = [...merged.values()].sort((a, b) =>
    a.score === b.score ? a.order - b.order : b.score - a.score,
  );
  return entries.slice(0, limit).map((entry) => ({ ...entry.result, score: entry.score }));
}

export async function hybridSearchDetailed(
  ctx: ApiContext,
  query: string,
  limit: number,
  pathFilter: string,
  options: string[] | SearchOptions,
  mode: string,
): Promise<HybridSearchResult> {
  const keyword = await ctx.db.searchChunks(query, limit, pathFilter, options);
  if (mode === "keyword") {
    return { results: keyword, effectiveMode: "keyword" };
  }

  const searchOpts = Array.isArray(options) ? undefined : options;
  if (searchOpts?.match === "phrase" || searchOpts?.match === "regex") {
    return {
      results: keyword,
      effectiveMode: "keyword",
      degradedReason: `match=${searchOpts.match} requires keyword search`,
    };
  }

  let vectors: number[][] = [];
  let model = "";
  try {
    const { client, settings } = await embeddingClient(ctx.db);
    model = settings.model;
    vectors = await client.embeddings(settings.model, [query]);
  } catch (error) {
    return {
      results: keyword,
      effectiveMode: "keyword",
      degradedReason: `embedding unavailable: ${errorMessage(error)}`,
    };
  }
  if (!vectors.length) {
    return {
      results: keyword,
      effectiveMode: "keyword",
      degradedReason: "embedding returned empty vectors",
    };
  }

  let semantic: SearchChunk[];
  try {
    semantic = await ctx.db.searchVector(vectors[0] ?? [], model, limit, pathFilter, options);
  } catch (error) {
    return {
      results: keyword,
      effectiveMode: "keyword",
      degradedReason: `vector search failed: ${errorMessage(error)}`,
    };
  }
  if (mode === "semantic") {
    return { results: markMatchType(semantic, "semantic"), effectiveMode: "semantic" };
  }
  return { results: fuseSearch(keyword, semantic, limit), effectiveMode: "hybrid" };
}

export async function hybridSearch(
  ctx: ApiContext,
  query: string,
  limit: number,
  pathFilter: string,
  options: string[] | SearchOptions,
  mode: string,
): Promise<SearchChunk[]> {
  const res = await hybridSearchDetailed(ctx, query, limit, pathFilter, options, mode);
  return res.results;
}

export const DEFAULT_SNIPPET_LENGTH = 280;

export function buildSearchSnippet(
  content: string,
  query: string,
  maxLen = DEFAULT_SNIPPET_LENGTH,
): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;

  const terms = query
    .trim()
    .split(/[\s,，。、;；:：/\\|()（）[\]【】"']+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const lower = normalized.toLowerCase();
  let matchIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1 && (matchIdx === -1 || idx < matchIdx)) {
      matchIdx = idx;
    }
  }

  let start = 0;
  if (matchIdx > 0) {
    const lead = Math.floor(maxLen * 0.3);
    start = Math.max(0, matchIdx - lead);
    if (start + maxLen > normalized.length) {
      start = Math.max(0, normalized.length - maxLen);
    }
  }

  const end = Math.min(normalized.length, start + maxLen);
  const slice = normalized.slice(start, end).trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}

function computeRelativePath(item: SearchChunk): string {
  if (item.relative_path && item.relative_path.trim()) return item.relative_path.trim().replace(/^\/+/, "");
  const cleanDir = item.path.trim().replace(/^\/+|\/+$/g, "");
  const cleanFile = item.filename.trim().replace(/^\/+/, "");
  if (!cleanDir) return cleanFile;
  if (!cleanFile) return cleanDir;
  if (cleanDir === cleanFile || cleanDir.endsWith(`/${cleanFile}`)) return cleanDir;
  return `${cleanDir}/${cleanFile}`;
}

export function attachSearchSnippets(results: SearchChunk[], query: string): SearchChunk[] {
  return results.map((item) => ({
    ...item,
    relative_path: computeRelativePath(item),
    snippet: item.snippet?.trim() ? item.snippet : buildSearchSnippet(item.content, query),
  }));
}

function parseListParams(c: Context, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const values = c.req.queries(key) ?? [];
    for (const v of values) {
      for (const part of v.split(",")) {
        const clean = part.trim();
        if (clean) out.push(clean);
      }
    }
  }
  return [...new Set(out)];
}

export function searchApi(ctx: ApiContext) {
  return {
    async search(c: Context): Promise<Response> {
      const query = c.req.query("q") ?? "";
      if (!query.trim()) return writeError(c, 400, "query parameter 'q' is required");

      const rawScope = (c.req.query("scope") ?? "wiki").trim().toLowerCase();
      if (!VALID_SEARCH_SCOPES.has(rawScope)) {
        return writeError(c, 400, "scope must be wiki, archives, or all");
      }
      const scope = rawScope as "wiki" | "archives" | "all";

      const rawMatch = (c.req.query("match") ?? "fuzzy").trim().toLowerCase() as SearchMatchMode;
      if (!VALID_MATCH_MODES.has(rawMatch)) {
        return writeError(c, 400, "match must be fuzzy, all_terms, phrase, or regex");
      }

      const rawSort = (c.req.query("sort") ?? "relevance").trim().toLowerCase() as SearchSortMode;
      if (!VALID_SORT_MODES.has(rawSort)) {
        return writeError(c, 400, "sort must be relevance, updated_desc, or updated_asc");
      }

      const rawLimit = parseLimit(c.req.query("limit"), 10);
      const limit = Math.max(1, Math.min(100, rawLimit));
      const rawOffset = parseLimit(c.req.query("offset"), 0);
      const offset = Math.max(0, rawOffset);

      if (rawMatch === "regex") {
        try {
          validateSearchRegex(query.trim());
        } catch (error) {
          return writeError(c, 400, errorMessage(error));
        }
      }

      const filter = c.req.query("filter") || "wiki";
      const folder = (c.req.query("folder") ?? "").trim();
      const pageTypes = parseListParams(c, "types", "type");
      const experienceKinds = parseListParams(c, "kinds", "kind");
      const statuses = parseListParams(c, "statuses", "status");
      const confidences = parseListParams(c, "confidences", "confidence");
      const tags = parseListParams(c, "tags", "tag");
      const tagMode = (c.req.query("tag_mode") ?? "any").trim().toLowerCase() === "all" ? "all" : "any";
      const updatedAfter = (c.req.query("updated_after") ?? "").trim() || undefined;
      const updatedBefore = (c.req.query("updated_before") ?? "").trim() || undefined;
      const caseSensitive = c.req.query("case_sensitive") === "true" || c.req.query("case_sensitive") === "1";
      const groupBy = (c.req.query("group_by") ?? "document").trim().toLowerCase() === "chunk" ? "chunk" : "document";

      const rawArchived = (c.req.query("archived") ?? "").trim().toLowerCase();
      const archived: ArchiveFilter =
        rawArchived === "include" || rawArchived === "only" || rawArchived === "exclude"
          ? rawArchived
          : c.req.query("include_archived") === "true"
            ? "include"
            : "exclude";
      const reviewOverdue = c.req.query("review_overdue") === "true";

      const searchOptions: SearchOptions = {
        page_types: pageTypes,
        experience_kinds: experienceKinds,
        statuses,
        confidences,
        archived,
        review_overdue: reviewOverdue,
        ...(folder ? { folder } : {}),
        ...(tags.length ? { tags, tag_mode: tagMode } : {}),
        ...(updatedAfter ? { updated_after: updatedAfter } : {}),
        ...(updatedBefore ? { updated_before: updatedBefore } : {}),
        sort: rawSort,
        match: rawMatch,
        case_sensitive: caseSensitive,
        group_by: groupBy,
      };

      const archiveOpts: ArchiveSearchOptions = {
        kind: (c.req.query("archive_kind") ?? c.req.query("kind") ?? "").trim() || undefined,
        folder_path: folder || undefined,
        origin: (c.req.query("origin") ?? "").trim() || undefined,
        media_type: (c.req.query("media_type") ?? "").trim() || undefined,
        unlinked_only: c.req.query("unlinked_only") === "true" || c.req.query("unlinked_only") === "1",
        updated_after: updatedAfter,
        updated_before: updatedBefore,
        match: rawMatch,
        case_sensitive: caseSensitive,
        limit: Math.min(500, Math.max(offset + limit + 1, 100)),
      };

      let mode = normalizeSearchMode(c.req.query("mode") ?? "");
      if (mode === "auto") mode = "hybrid";

      const fetchLimit = Math.min(500, Math.max(offset + limit + 1, 100));

      try {
        const wikiPromise =
          scope === "archives"
            ? Promise.resolve<HybridSearchResult>({ results: [], effectiveMode: mode })
            : hybridSearchDetailed(ctx, query, fetchLimit, filter, searchOptions, mode);

        const archivePromise =
          scope === "wiki" || typeof ctx.db.searchArchiveFiles !== "function"
            ? Promise.resolve<ArchiveSearchHit[]>([])
            : ctx.db.searchArchiveFiles(query.trim(), archiveOpts);

        const [wikiRes, allArchives] = await Promise.all([wikiPromise, archivePromise]);

        let wikiItems = attachSearchSnippets(wikiRes.results, query);
        if (rawSort === "updated_desc") {
          wikiItems = [...wikiItems].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
        } else if (rawSort === "updated_asc") {
          wikiItems = [...wikiItems].sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
        }

        const wikiTotal = wikiItems.length;
        const wikiPage = wikiItems.slice(offset, offset + limit);
        const archiveTotal = allArchives.length;
        const archivePage = allArchives.slice(offset, offset + limit);

        if (scope === "archives") {
          return writeJson(c, 200, {
            query,
            scope,
            results: [],
            archive_results: archivePage,
            total: 0,
            archive_total: archiveTotal,
            limit,
            offset,
            has_more: offset + archivePage.length < archiveTotal,
          });
        }

        const payload: Record<string, unknown> = {
          query,
          scope,
          mode,
          effective_mode: wikiRes.effectiveMode,
          ...(wikiRes.degradedReason ? { degraded_reason: wikiRes.degradedReason } : {}),
          results: wikiPage,
          total: wikiTotal,
          limit,
          offset,
          has_more:
            scope === "all"
              ? offset + wikiPage.length < wikiTotal || offset + archivePage.length < archiveTotal
              : offset + wikiPage.length < wikiTotal,
        };
        if (scope === "all") {
          payload["archive_results"] = archivePage;
          payload["archive_total"] = archiveTotal;
        }
        return writeJson(c, 200, payload);
      } catch (error) {
        if (error instanceof SearchValidationError || error instanceof ArchiveValidationError) {
          return writeError(c, 400, errorMessage(error));
        }
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
