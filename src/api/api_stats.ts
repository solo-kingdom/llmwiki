import type { Context } from "hono";
import { isApiKeyRequest } from "../server/auth.js";
import type {
  ApiAuthType,
  ApiStatsFilter,
  ApiStatsRange,
  ApiStatsRouteSort,
  ApiStatsStatusClass,
} from "../store/types.js";
import { writeError, writeJson, type ApiContext } from "./context.js";

const RANGE_DURATIONS_MS: Record<ApiStatsRange, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const VALID_RANGES = new Set<string>(["1h", "24h", "7d", "30d"]);
const VALID_STATUS_CLASSES = new Set<string>(["2xx", "3xx", "4xx", "5xx"]);
const VALID_AUTH_TYPES = new Set<string>(["session", "api_key", "anonymous", "invalid_key"]);
const VALID_SORTS = new Set<string>(["count", "error_rate", "p95"]);

function parseFilter(c: Context): { filter?: ApiStatsFilter; error?: string } {
  const rawRange = (c.req.query("range") ?? "24h").trim();
  if (!VALID_RANGES.has(rawRange)) {
    return { error: `invalid range: ${rawRange}` };
  }
  const range = rawRange as ApiStatsRange;

  const rawFrom = c.req.query("from")?.trim();
  const rawTo = c.req.query("to")?.trim();
  const now = Date.now();
  let fromIso: string;
  let toIso: string;

  if (rawFrom) {
    const ms = Date.parse(rawFrom);
    if (!Number.isFinite(ms)) return { error: "invalid from timestamp" };
    fromIso = new Date(ms).toISOString();
  } else {
    fromIso = new Date(now - RANGE_DURATIONS_MS[range]).toISOString();
  }

  if (rawTo) {
    const ms = Date.parse(rawTo);
    if (!Number.isFinite(ms)) return { error: "invalid to timestamp" };
    toIso = new Date(ms).toISOString();
  } else {
    toIso = new Date(now).toISOString();
  }

  if (Date.parse(fromIso) > Date.parse(toIso)) {
    return { error: "from must be before to" };
  }

  const rawStatusClass = c.req.query("status_class")?.trim();
  if (rawStatusClass && !VALID_STATUS_CLASSES.has(rawStatusClass)) {
    return { error: `invalid status_class: ${rawStatusClass}` };
  }

  const rawAuthType = c.req.query("auth_type")?.trim();
  if (rawAuthType && !VALID_AUTH_TYPES.has(rawAuthType)) {
    return { error: `invalid auth_type: ${rawAuthType}` };
  }

  const method = c.req.query("method")?.trim().toUpperCase() || undefined;
  const route = c.req.query("route")?.trim() || undefined;
  const apiKeyId = c.req.query("api_key_id")?.trim() || undefined;

  return {
    filter: {
      range,
      from: fromIso,
      to: toIso,
      method,
      route,
      status_class: rawStatusClass ? (rawStatusClass as ApiStatsStatusClass) : undefined,
      auth_type: rawAuthType ? (rawAuthType as ApiAuthType) : undefined,
      api_key_id: apiKeyId,
    },
  };
}

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function guardApiKey(c: Context): Response | null {
  if (isApiKeyRequest(c)) {
    return writeError(c, 403, "api key cannot access api stats");
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function apiStatsApi(ctx: ApiContext) {
  return {
    async getApiStatsOverview(c: Context): Promise<Response> {
      const denied = guardApiKey(c);
      if (denied) return denied;
      const { filter, error } = parseFilter(c);
      if (!filter) return writeError(c, 400, error ?? "invalid query");
      try {
        const result = await ctx.db.getApiStatsOverview(filter);
        return writeJson(c, 200, result);
      } catch (err) {
        return writeError(c, 500, errorMessage(err));
      }
    },

    async getApiStatsRoutes(c: Context): Promise<Response> {
      const denied = guardApiKey(c);
      if (denied) return denied;
      const { filter, error } = parseFilter(c);
      if (!filter) return writeError(c, 400, error ?? "invalid query");

      const rawSort = (c.req.query("sort") ?? "count").trim();
      if (!VALID_SORTS.has(rawSort)) {
        return writeError(c, 400, `invalid sort: ${rawSort}`);
      }
      const limit = parseLimit(c.req.query("limit"), 50, 200);

      try {
        const result = await ctx.db.getApiStatsRoutes(filter, {
          sort: rawSort as ApiStatsRouteSort,
          limit,
        });
        return writeJson(c, 200, result);
      } catch (err) {
        return writeError(c, 500, errorMessage(err));
      }
    },

    async getApiStatsErrors(c: Context): Promise<Response> {
      const denied = guardApiKey(c);
      if (denied) return denied;
      const { filter, error } = parseFilter(c);
      if (!filter) return writeError(c, 400, error ?? "invalid query");
      const limit = parseLimit(c.req.query("limit"), 50, 100);

      try {
        const result = await ctx.db.getApiStatsErrors(filter, limit);
        return writeJson(c, 200, result);
      } catch (err) {
        return writeError(c, 500, errorMessage(err));
      }
    },

    async getApiStatsApiKeys(c: Context): Promise<Response> {
      const denied = guardApiKey(c);
      if (denied) return denied;
      const { filter, error } = parseFilter(c);
      if (!filter) return writeError(c, 400, error ?? "invalid query");

      try {
        const result = await ctx.db.getApiStatsApiKeys(filter);
        return writeJson(c, 200, result);
      } catch (err) {
        return writeError(c, 500, errorMessage(err));
      }
    },

    async getApiStatsApiKeyDetail(c: Context): Promise<Response> {
      const denied = guardApiKey(c);
      if (denied) return denied;
      const keyId = (c.req.param("keyId") ?? "").trim();
      if (!keyId) return writeError(c, 400, "keyId is required");
      const { filter, error } = parseFilter(c);
      if (!filter) return writeError(c, 400, error ?? "invalid query");

      try {
        const result = await ctx.db.getApiStatsApiKeyDetail(keyId, filter);
        if (!result) return writeError(c, 404, "api key not found");
        return writeJson(c, 200, result);
      } catch (err) {
        return writeError(c, 500, errorMessage(err));
      }
    },
  };
}
