import type { Pool, PoolClient, QueryArrayConfig } from "pg";

export const NOW_TEXT = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";

type Queryable = Pool | PoolClient;

export async function queryRows<T extends unknown[]>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await db.query({ text, values, rowMode: "array" } as QueryArrayConfig);
  return result.rows as unknown as T[];
}

export async function queryOne<T extends unknown[]>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await queryRows<T>(db, text, values);
  return rows[0] ?? null;
}

export async function exec(db: Queryable, text: string, values: unknown[] = []): Promise<number> {
  const result = await db.query(text, values);
  return result.rowCount ?? 0;
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

export function asString(value: unknown): string {
  return value == null ? "" : String(value);
}

export function asBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

const BARE_UTC_TS_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;
const BARE_DB_TS_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/;
const HAS_TZ_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Normalizes bare Postgres UTC strings (`YYYY-MM-DD HH:MM:SS`) into ISO-8601 UTC (`...Z`)
 * so browsers and JS `Date` parse them as UTC rather than local time.
 */
export function asUtcTimestamp(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) return "";
  const match = BARE_UTC_TS_RE.exec(raw);
  if (match) return `${match[1]}T${match[2]}Z`;
  return raw;
}

/**
 * Formats an ISO-8601 or bare timestamp back into the DB's UTC `YYYY-MM-DD HH:MM:SS` text
 * format so lexicographical comparisons and stored columns remain consistent.
 */
export function toDbUtcTimestamp(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const bare = BARE_DB_TS_RE.exec(raw);
  if (bare) return `${bare[1]} ${bare[2]}`;
  if (HAS_TZ_RE.test(raw)) {
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
    }
  }
  return raw;
}
