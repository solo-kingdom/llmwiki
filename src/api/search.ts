import type { Context } from "hono";
import { embeddingClient } from "../llm/embeddings.js";
import type { ArchiveFilter, SearchChunk, SearchOptions } from "../store/types.js";
import { writeError, writeJson, type ApiContext } from "./context.js";

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

export async function hybridSearch(
  ctx: ApiContext,
  query: string,
  limit: number,
  pathFilter: string,
  options: string[] | SearchOptions,
  mode: string,
): Promise<SearchChunk[]> {
  const keyword = await ctx.db.searchChunks(query, limit, pathFilter, options);
  if (mode === "keyword") return keyword;

  let vectors: number[][] = [];
  let model = "";
  try {
    const { client, settings } = await embeddingClient(ctx.db);
    model = settings.model;
    vectors = await client.embeddings(settings.model, [query]);
  } catch {
    return keyword;
  }
  if (!vectors.length) return keyword;

  let semantic: SearchChunk[];
  try {
    semantic = await ctx.db.searchVector(vectors[0] ?? [], model, limit, pathFilter, options);
  } catch {
    return keyword;
  }
  if (mode === "semantic") return markMatchType(semantic, "semantic");
  return fuseSearch(keyword, semantic, limit);
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

export function attachSearchSnippets(results: SearchChunk[], query: string): SearchChunk[] {
  return results.map((item) => ({
    ...item,
    snippet: item.snippet?.trim() ? item.snippet : buildSearchSnippet(item.content, query),
  }));
}

export function searchApi(ctx: ApiContext) {
  return {
    async search(c: Context): Promise<Response> {
      const query = c.req.query("q") ?? "";
      if (!query) return writeError(c, 400, "query parameter 'q' is required");
      const limit = parseLimit(c.req.query("limit"), 10);
      const filter = c.req.query("filter") || "wiki";
      const pageTypes = c.req.queries("types") ?? c.req.queries("type") ?? [];
      const experienceKinds = c.req.queries("kinds") ?? c.req.queries("kind") ?? [];
      const statuses = c.req.queries("statuses") ?? c.req.queries("status") ?? [];
      const confidences = c.req.queries("confidences") ?? c.req.queries("confidence") ?? [];
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
      };
      let mode = normalizeSearchMode(c.req.query("mode") ?? "");
      if (mode === "auto") mode = "hybrid";
      try {
        const rawResults = await hybridSearch(ctx, query, limit, filter, searchOptions, mode);
        const results = attachSearchSnippets(rawResults, query);
        return writeJson(c, 200, { query, mode, results });
      } catch (error) {
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
