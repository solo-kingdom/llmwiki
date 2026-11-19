import { Pool } from "pg";

export type Db = Pool;

export function openDatabase(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
}

export async function closeDatabase(pool: Pool): Promise<void> {
  await pool.end();
}
