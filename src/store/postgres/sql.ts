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
