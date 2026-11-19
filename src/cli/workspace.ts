import path from "node:path";
import { resolveDatabaseUrl } from "../config.js";
import { openDatabase } from "../db/pool.js";
import { openStore } from "../store/postgres/db.js";
import type { Store } from "../store/interfaces.js";

export function resolveWorkspaceDir(arg: string | undefined): string {
  return path.resolve(arg && arg.trim() ? arg : process.cwd());
}

export async function openCliStore(databaseUrl?: string): Promise<Store> {
  const pool = openDatabase(resolveDatabaseUrl(databaseUrl));
  return openStore(pool);
}

export function isLoopback(addr: string): boolean {
  return addr === "localhost" || addr === "127.0.0.1" || addr === "::1";
}
