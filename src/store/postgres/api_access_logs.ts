import type { Pool } from "pg";
import type { ApiAccessStatsStore } from "../interfaces.js";
import type {
  ApiAccessLogInput,
  ApiAccessLogRecord,
  ApiAuthOutcome,
  ApiAuthType,
  ApiStatsApiKeyItem,
  ApiStatsApiKeysResponse,
  ApiStatsApiKeyDetailResponse,
  ApiStatsErrorsResponse,
  ApiStatsFilter,
  ApiStatsOverviewResponse,
  ApiStatsRange,
  ApiStatsRouteItem,
  ApiStatsRouteSort,
  ApiStatsRoutesResponse,
  ApiStatsSeriesPoint,
  ApiStatsStatusClass,
} from "../types.js";
import { asNumber, asString, asUtcTimestamp, exec, queryOne, queryRows } from "./sql.js";

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return asUtcTimestamp(value);
}

function asFloat(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveBucketUnit(filter: ApiStatsFilter): "minute" | "hour" | "day" {
  if (filter.range === "1h") return "minute";
  if (filter.range === "7d" || filter.range === "30d") return "day";
  if (filter.range === "24h") return "hour";
  const fromMs = Date.parse(filter.from);
  const toMs = Date.parse(filter.to);
  if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
    const diffHours = (toMs - fromMs) / 3_600_000;
    if (diffHours <= 2) return "minute";
    if (diffHours <= 72) return "hour";
    return "day";
  }
  return "hour";
}

function buildWhere(
  filter: ApiStatsFilter,
  alias = "",
  extraConditions: string[] = [],
): { clause: string; values: unknown[] } {
  const prefix = alias ? `${alias}.` : "";
  const conditions: string[] = [
    `${prefix}occurred_at >= $1::timestamptz`,
    `${prefix}occurred_at <= $2::timestamptz`,
  ];
  const values: unknown[] = [filter.from, filter.to];

  if (filter.method) {
    values.push(filter.method.toUpperCase());
    conditions.push(`${prefix}method = $${values.length}`);
  }
  if (filter.route) {
    values.push(filter.route);
    conditions.push(`${prefix}route_template = $${values.length}`);
  }
  if (filter.status_class) {
    if (filter.status_class === "2xx") {
      conditions.push(`${prefix}status_code >= 200 AND ${prefix}status_code < 300`);
    } else if (filter.status_class === "3xx") {
      conditions.push(`${prefix}status_code >= 300 AND ${prefix}status_code < 400`);
    } else if (filter.status_class === "4xx") {
      conditions.push(`${prefix}status_code >= 400 AND ${prefix}status_code < 500`);
    } else if (filter.status_class === "5xx") {
      conditions.push(`${prefix}status_code >= 500 AND ${prefix}status_code < 600`);
    }
  }
  if (filter.auth_type) {
    values.push(filter.auth_type);
    conditions.push(`${prefix}auth_type = $${values.length}`);
  }
  if (filter.api_key_id) {
    if (filter.api_key_id === "__invalid__") {
      conditions.push(`${prefix}auth_type = 'invalid_key'`);
    } else {
      values.push(filter.api_key_id);
      conditions.push(`${prefix}api_key_id = $${values.length}`);
    }
  }

  for (const extra of extraConditions) {
    conditions.push(extra);
  }

  return {
    clause: `WHERE ${conditions.join(" AND ")}`,
    values,
  };
}

function mapLogRow(row: unknown[]): ApiAccessLogRecord {
  return {
    id: asNumber(row[0]),
    occurred_at: toIso(row[1]),
    method: asString(row[2]),
    route_template: asString(row[3]),
    status_code: asNumber(row[4]),
    duration_ms: asNumber(row[5]),
    auth_type: asString(row[6]) as ApiAuthType,
    user_id: row[7] == null ? null : asString(row[7]),
    api_key_id: row[8] == null ? null : asString(row[8]),
    api_key_prefix: row[9] == null ? null : asString(row[9]),
    api_key_name: row[10] == null ? null : asString(row[10]),
    auth_outcome: asString(row[11]) as ApiAuthOutcome,
    client_ip: row[12] == null ? null : asString(row[12]),
    user_agent: row[13] == null ? null : asString(row[13]),
    error_code: row[14] == null ? null : asString(row[14]),
  };
}

function mapRouteRow(row: unknown[]): ApiStatsRouteItem {
  const count = asNumber(row[2]);
  const error4xx = asNumber(row[3]);
  const error5xx = asNumber(row[4]);
  return {
    method: asString(row[0]),
    route_template: asString(row[1]),
    count,
    error_4xx: error4xx,
    error_5xx: error5xx,
    error_rate: count > 0 ? round2(((error4xx + error5xx) / count) * 100) : 0,
    avg_ms: round2(asFloat(row[5])),
    p95_ms: round2(asFloat(row[6])),
    p99_ms: round2(asFloat(row[7])),
  };
}

function mapSeriesRows(rows: unknown[][]): ApiStatsSeriesPoint[] {
  return rows.map((row) => ({
    bucket_start: toIso(row[0]),
    requests: asNumber(row[1]),
    error_4xx: asNumber(row[2]),
    error_5xx: asNumber(row[3]),
    p95_ms: round2(asFloat(row[4])),
  }));
}

export function apiAccessLogsRepo(pool: Pool): ApiAccessStatsStore {
  return {
    async insertApiAccessLogs(entries: ApiAccessLogInput[]): Promise<void> {
      if (entries.length === 0) return;
      const values: unknown[] = [];
      const tuples: string[] = [];
      for (const entry of entries) {
        const base = values.length;
        values.push(
          entry.occurred_at,
          entry.method,
          entry.route_template,
          entry.status_code,
          Math.max(0, Math.round(entry.duration_ms)),
          entry.auth_type,
          entry.user_id ?? null,
          entry.api_key_id ?? null,
          entry.api_key_prefix ?? null,
          entry.api_key_name ?? null,
          entry.auth_outcome,
          entry.client_ip ?? null,
          entry.user_agent ?? null,
          entry.error_code ?? null,
        );
        tuples.push(
          `($${base + 1}::timestamptz, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`,
        );
      }
      await exec(
        pool,
        `INSERT INTO api_access_logs (
          occurred_at, method, route_template, status_code, duration_ms,
          auth_type, user_id, api_key_id, api_key_prefix, api_key_name,
          auth_outcome, client_ip, user_agent, error_code
        ) VALUES ${tuples.join(", ")}`,
        values,
      );
    },

    async purgeExpiredApiAccessLogs(beforeIso: string, batchSize = 5000): Promise<number> {
      const limit = Math.max(1, Math.min(batchSize, 50_000));
      return exec(
        pool,
        `DELETE FROM api_access_logs
         WHERE id IN (
           SELECT id FROM api_access_logs
           WHERE occurred_at < $1::timestamptz
           ORDER BY occurred_at ASC
           LIMIT $2
         )`,
        [beforeIso, limit],
      );
    },

    async getApiStatsOverview(filter: ApiStatsFilter): Promise<ApiStatsOverviewResponse> {
      const bucket = resolveBucketUnit(filter);
      const { clause, values } = buildWhere(filter);

      const summaryRow = await queryOne<unknown[]>(
        pool,
        `SELECT
           COUNT(*)::int AS total_requests,
           COUNT(*) FILTER (WHERE status_code < 400)::int AS ok_count,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS err_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS err_5xx,
           COALESCE(AVG(duration_ms), 0)::float8 AS avg_ms,
           COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p50_ms,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p95_ms,
           COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p99_ms,
           COUNT(DISTINCT route_template)::int AS active_routes
         FROM api_access_logs
         ${clause}`,
        values,
      );

      const total = summaryRow ? asNumber(summaryRow[0]) : 0;
      const okCount = summaryRow ? asNumber(summaryRow[1]) : 0;
      const err4xx = summaryRow ? asNumber(summaryRow[2]) : 0;
      const err5xx = summaryRow ? asNumber(summaryRow[3]) : 0;
      const windowSeconds = Math.max(1, (Date.parse(filter.to) - Date.parse(filter.from)) / 1000 || 86400);

      const seriesRows = await queryRows<unknown[]>(
        pool,
        `SELECT
           date_trunc('${bucket}', occurred_at) AS bucket_start,
           COUNT(*)::int AS requests,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS error_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS error_5xx,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p95_ms
         FROM api_access_logs
         ${clause}
         GROUP BY bucket_start
         ORDER BY bucket_start ASC`,
        values,
      );

      const statusRows = await queryRows<unknown[]>(
        pool,
        `SELECT
           CASE
             WHEN status_code >= 200 AND status_code < 300 THEN '2xx'
             WHEN status_code >= 300 AND status_code < 400 THEN '3xx'
             WHEN status_code >= 400 AND status_code < 500 THEN '4xx'
             ELSE '5xx'
           END AS status_class,
           COUNT(*)::int AS count
         FROM api_access_logs
         ${clause}
         GROUP BY status_class
         ORDER BY status_class ASC`,
        values,
      );

      const authRows = await queryRows<unknown[]>(
        pool,
        `SELECT auth_type, COUNT(*)::int AS count
         FROM api_access_logs
         ${clause}
         GROUP BY auth_type
         ORDER BY count DESC`,
        values,
      );

      return {
        capabilities: {
          has_api_keys: true,
          scope: "global",
        },
        range: {
          key: (filter.range ?? "24h") as ApiStatsRange,
          from: filter.from,
          to: filter.to,
          bucket,
        },
        summary: {
          total_requests: total,
          rps: round2(total / windowSeconds),
          success_rate: total > 0 ? round2((okCount / total) * 100) : 0,
          error_4xx_rate: total > 0 ? round2((err4xx / total) * 100) : 0,
          error_5xx_rate: total > 0 ? round2((err5xx / total) * 100) : 0,
          avg_duration_ms: summaryRow ? round2(asFloat(summaryRow[4])) : 0,
          p50_ms: summaryRow ? round2(asFloat(summaryRow[5])) : 0,
          p95_ms: summaryRow ? round2(asFloat(summaryRow[6])) : 0,
          p99_ms: summaryRow ? round2(asFloat(summaryRow[7])) : 0,
          active_routes: summaryRow ? asNumber(summaryRow[8]) : 0,
        },
        series: mapSeriesRows(seriesRows),
        status_distribution: statusRows.map((row) => ({
          status_class: asString(row[0]) as ApiStatsStatusClass,
          count: asNumber(row[1]),
        })),
        auth_sources: authRows.map((row) => ({
          auth_type: asString(row[0]) as ApiAuthType,
          count: asNumber(row[1]),
        })),
      };
    },

    async getApiStatsRoutes(
      filter: ApiStatsFilter,
      options?: { sort?: ApiStatsRouteSort; limit?: number },
    ): Promise<ApiStatsRoutesResponse> {
      const sort = options?.sort ?? "count";
      const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
      const { clause, values } = buildWhere(filter);
      values.push(limit);

      const orderBy =
        sort === "error_rate"
          ? "((COUNT(*) FILTER (WHERE status_code >= 400))::float8 / GREATEST(COUNT(*), 1)) DESC, COUNT(*) DESC"
          : sort === "p95"
            ? "COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) DESC, COUNT(*) DESC"
            : "COUNT(*) DESC, method ASC, route_template ASC";

      const rows = await queryRows<unknown[]>(
        pool,
        `SELECT
           method,
           route_template,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS error_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS error_5xx,
           COALESCE(AVG(duration_ms), 0)::float8 AS avg_ms,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p95_ms,
           COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p99_ms
         FROM api_access_logs
         ${clause}
         GROUP BY method, route_template
         ORDER BY ${orderBy}
         LIMIT $${values.length}`,
        values,
      );

      return {
        items: rows.map(mapRouteRow),
      };
    },

    async getApiStatsErrors(filter: ApiStatsFilter, limit = 50): Promise<ApiStatsErrorsResponse> {
      const safeLimit = Math.max(1, Math.min(limit, 100));
      const { clause, values } = buildWhere(filter, "", ["status_code >= 400"]);
      values.push(safeLimit);

      const rows = await queryRows<unknown[]>(
        pool,
        `SELECT
           id, occurred_at, method, route_template, status_code, duration_ms,
           auth_type, user_id, api_key_id, api_key_prefix, api_key_name,
           auth_outcome, client_ip, user_agent, error_code
         FROM api_access_logs
         ${clause}
         ORDER BY occurred_at DESC, id DESC
         LIMIT $${values.length}`,
        values,
      );

      return {
        items: rows.map(mapLogRow),
      };
    },

    async getApiStatsApiKeys(filter: ApiStatsFilter): Promise<ApiStatsApiKeysResponse> {
      const { clause, values } = buildWhere(filter, "l");

      const anomalyRow = await queryOne<unknown[]>(
        pool,
        `SELECT
           COUNT(*) FILTER (WHERE l.auth_type = 'invalid_key' AND l.status_code = 401)::int AS unauthorized_401,
           COUNT(*) FILTER (WHERE l.auth_type = 'api_key' AND l.status_code = 403)::int AS forbidden_403
         FROM api_access_logs l
         ${clause}`,
        values,
      );

      const keyRows = await queryRows<unknown[]>(
        pool,
        `SELECT
           l.api_key_id,
           COALESCE(MAX(k.prefix), MAX(l.api_key_prefix), '') AS api_key_prefix,
           COALESCE(MAX(k.name), MAX(l.api_key_name), '') AS api_key_name,
           MAX(l.user_id) AS user_id,
           CASE WHEN MAX(k.id) IS NOT NULL THEN 'active' ELSE 'revoked' END AS status,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE l.status_code >= 400 AND l.status_code < 500)::int AS error_4xx,
           COUNT(*) FILTER (WHERE l.status_code >= 500)::int AS error_5xx,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY l.duration_ms), 0)::float8 AS p95_ms,
           MAX(l.occurred_at) AS last_seen_at
         FROM api_access_logs l
         LEFT JOIN api_keys k ON k.id = l.api_key_id
         ${clause} AND l.api_key_id IS NOT NULL
         GROUP BY l.api_key_id
         ORDER BY count DESC, last_seen_at DESC`,
        values,
      );

      const activeKeyRows = await queryRows<unknown[]>(
        pool,
        `SELECT id, prefix, name FROM api_keys ORDER BY created_at DESC`,
      );

      const totalKeyRequests = keyRows.reduce((sum, row) => sum + asNumber(row[5]), 0);
      const seenKeyIds = new Set<string>();
      const items: ApiStatsApiKeyItem[] = keyRows.map((row) => {
        const id = asString(row[0]);
        seenKeyIds.add(id);
        const count = asNumber(row[5]);
        return {
          api_key_id: id,
          api_key_prefix: asString(row[1]),
          api_key_name: asString(row[2]),
          user_id: row[3] == null ? null : asString(row[3]),
          status: asString(row[4]) === "active" ? "active" : "revoked",
          count,
          share_pct: totalKeyRequests > 0 ? round2((count / totalKeyRequests) * 100) : 0,
          error_4xx: asNumber(row[6]),
          error_5xx: asNumber(row[7]),
          p95_ms: round2(asFloat(row[8])),
          last_seen_at: row[9] == null ? null : toIso(row[9]),
        };
      });

      for (const active of activeKeyRows) {
        const id = asString(active[0]);
        if (seenKeyIds.has(id)) continue;
        items.push({
          api_key_id: id,
          api_key_prefix: asString(active[1]),
          api_key_name: asString(active[2]),
          user_id: null,
          status: "active",
          count: 0,
          share_pct: 0,
          error_4xx: 0,
          error_5xx: 0,
          p95_ms: 0,
          last_seen_at: null,
        });
      }

      return {
        summary: {
          total_key_requests: totalKeyRequests,
          active_key_count: activeKeyRows.length,
          unauthorized_401_count: anomalyRow ? asNumber(anomalyRow[0]) : 0,
          forbidden_403_count: anomalyRow ? asNumber(anomalyRow[1]) : 0,
        },
        items,
      };
    },

    async getApiStatsApiKeyDetail(
      keyId: string,
      filter: ApiStatsFilter,
    ): Promise<ApiStatsApiKeyDetailResponse | null> {
      const bucket = resolveBucketUnit(filter);
      const isInvalid = keyId === "__invalid__";
      const scopedFilter: ApiStatsFilter = isInvalid
        ? { ...filter, auth_type: "invalid_key", api_key_id: undefined }
        : { ...filter, api_key_id: keyId };

      const { clause, values } = buildWhere(scopedFilter);

      const summaryRow = await queryOne<unknown[]>(
        pool,
        `SELECT
           COUNT(*)::int AS total_requests,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS error_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS error_5xx,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p95_ms,
           MAX(occurred_at) AS last_seen_at,
           MAX(api_key_prefix) AS api_key_prefix,
           MAX(api_key_name) AS api_key_name
         FROM api_access_logs
         ${clause}`,
        values,
      );

      let keyMeta: {
        api_key_id: string;
        api_key_prefix: string;
        api_key_name: string;
        status: "active" | "revoked" | "invalid";
      };

      if (isInvalid) {
        keyMeta = {
          api_key_id: "__invalid__",
          api_key_prefix: "invalid",
          api_key_name: "无效 / 已吊销 Key 尝试",
          status: "invalid",
        };
      } else {
        const keyRow = await queryOne<unknown[]>(
          pool,
          `SELECT id, prefix, name FROM api_keys WHERE id = $1`,
          [keyId],
        );
        const total = summaryRow ? asNumber(summaryRow[0]) : 0;
        if (!keyRow && total === 0) return null;
        keyMeta = {
          api_key_id: keyId,
          api_key_prefix: keyRow ? asString(keyRow[1]) : asString(summaryRow?.[5]),
          api_key_name: keyRow ? asString(keyRow[2]) : asString(summaryRow?.[6]),
          status: keyRow ? "active" : "revoked",
        };
      }

      const seriesRows = await queryRows<unknown[]>(
        pool,
        `SELECT
           date_trunc('${bucket}', occurred_at) AS bucket_start,
           COUNT(*)::int AS requests,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS error_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS error_5xx,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p95_ms
         FROM api_access_logs
         ${clause}
         GROUP BY bucket_start
         ORDER BY bucket_start ASC`,
        values,
      );

      const topRouteRows = await queryRows<unknown[]>(
        pool,
        `SELECT
           method, route_template,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS error_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS error_5xx,
           COALESCE(AVG(duration_ms), 0)::float8 AS avg_ms,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p95_ms,
           COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p99_ms
         FROM api_access_logs
         ${clause}
         GROUP BY method, route_template
         ORDER BY count DESC
         LIMIT 20`,
        values,
      );

      const errorRouteRows = await queryRows<unknown[]>(
        pool,
        `SELECT
           method, route_template,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS error_4xx,
           COUNT(*) FILTER (WHERE status_code >= 500)::int AS error_5xx,
           COALESCE(AVG(duration_ms), 0)::float8 AS avg_ms,
           COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p95_ms,
           COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms), 0)::float8 AS p99_ms
         FROM api_access_logs
         ${clause} AND status_code >= 400
         GROUP BY method, route_template
         ORDER BY count DESC
         LIMIT 20`,
        values,
      );

      const recentErrorRows = await queryRows<unknown[]>(
        pool,
        `SELECT
           id, occurred_at, method, route_template, status_code, duration_ms,
           auth_type, user_id, api_key_id, api_key_prefix, api_key_name,
           auth_outcome, client_ip, user_agent, error_code
         FROM api_access_logs
         ${clause} AND status_code >= 400
         ORDER BY occurred_at DESC, id DESC
         LIMIT 50`,
        values,
      );

      return {
        key: {
          ...keyMeta,
          total_requests: summaryRow ? asNumber(summaryRow[0]) : 0,
          error_4xx: summaryRow ? asNumber(summaryRow[1]) : 0,
          error_5xx: summaryRow ? asNumber(summaryRow[2]) : 0,
          p95_ms: summaryRow ? round2(asFloat(summaryRow[3])) : 0,
          last_seen_at: summaryRow && summaryRow[4] != null ? toIso(summaryRow[4]) : null,
        },
        series: mapSeriesRows(seriesRows),
        top_routes: topRouteRows.map(mapRouteRow),
        error_routes: errorRouteRows.map(mapRouteRow),
        recent_errors: recentErrorRows.map(mapLogRow),
      };
    },
  };
}
