import type { Context } from "hono";
import { embeddingClient } from "../llm/embeddings.js";
import type { SearchChunk } from "../store/types.js";
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
  pageTypes: string[],
  mode: string,
): Promise<SearchChunk[]> {
  const keyword = await ctx.db.searchChunks(query, limit, pathFilter, pageTypes);
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
    semantic = await ctx.db.searchVector(vectors[0] ?? [], model, limit, pathFilter, pageTypes);
  } catch {
    return keyword;
  }
  if (mode === "semantic") return markMatchType(semantic, "semantic");
  return fuseSearch(keyword, semantic, limit);
}

export function searchApi(ctx: ApiContext) {
  return {
    async search(c: Context): Promise<Response> {
      const query = c.req.query("q") ?? "";
      if (!query) return writeError(c, 400, "query parameter 'q' is required");
      const limit = parseLimit(c.req.query("limit"), 10);
      const filter = c.req.query("filter") || "wiki";
      const pageTypes = c.req.queries("types") ?? [];
      let mode = normalizeSearchMode(c.req.query("mode") ?? "");
      if (mode === "auto") mode = "hybrid";
      try {
        const results = await hybridSearch(ctx, query, limit, filter, pageTypes, mode);
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
