import type { Pool } from "pg";
import type { ActivityStore } from "../interfaces.js";
import type { ActivityLog, ActivityLogListFilter } from "../types.js";
import { NOW_TEXT, asNumber, asString, asUtcTimestamp, exec, queryOne, queryRows } from "./sql.js";

const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);

function normalizeActivityLevel(level: string): string {
  const normalized = level.trim().toLowerCase();
  return VALID_LEVELS.has(normalized) ? normalized : "info";
}

const ACTIVITY_LOG_SELECT = `
  COALESCE(id, 0), COALESCE(created_at, ''), COALESCE(level, 'info'),
  COALESCE(category, ''), COALESCE(action, ''), COALESCE(message, ''),
  COALESCE(resource_type, ''), COALESCE(resource_id, ''), COALESCE(status, ''),
  COALESCE(details, ''), COALESCE(source, '')`;

function scanActivityLog(row: unknown[]): ActivityLog {
  return {
    id: asNumber(row[0]),
    created_at: asUtcTimestamp(row[1]),
    level: asString(row[2]),
    category: asString(row[3]),
    action: asString(row[4]),
    message: asString(row[5]),
    resource_type: asString(row[6]),
    resource_id: asString(row[7]),
    status: asString(row[8]),
    details: asString(row[9]),
    source: asString(row[10]),
  };
}

export function activityRepo(pool: Pool): ActivityStore {
  return {
    async createActivityLog(log: ActivityLog): Promise<void> {
      if (!log) throw new Error("nil activity log");
      log.level = normalizeActivityLevel(log.level);
      if (!log.category) throw new Error("category is required");
      if (!log.action) throw new Error("action is required");

      const row = await queryOne<unknown[]>(
        pool,
        `INSERT INTO activity_logs (
          level, category, action, message,
          resource_type, resource_id, status, details, source, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${NOW_TEXT})
        RETURNING ${ACTIVITY_LOG_SELECT}`,
        [
          log.level,
          log.category,
          log.action,
          log.message,
          log.resource_type,
          log.resource_id,
          log.status,
          log.details,
          log.source,
        ],
      );
      if (!row) throw new Error("create activity log: no row returned");
      Object.assign(log, scanActivityLog(row));
    },

    async listActivityLogs(filter: ActivityLogListFilter): Promise<ActivityLog[]> {
      let limit = filter.limit;
      if (limit <= 0 || limit > 500) limit = 50;
      const offset = filter.offset < 0 ? 0 : filter.offset;

      let sql = `SELECT ${ACTIVITY_LOG_SELECT} FROM activity_logs WHERE 1=1`;
      const args: unknown[] = [];
      const add = (value: unknown) => {
        args.push(value);
        return `$${args.length}`;
      };
      const category = filter.category.trim();
      if (category) sql += ` AND category = ${add(category)}`;
      const level = filter.level.trim();
      if (level) sql += ` AND level = ${add(normalizeActivityLevel(level))}`;
      sql += ` ORDER BY created_at DESC, id DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`;

      const rows = await queryRows(pool, sql, args);
      return rows.map(scanActivityLog);
    },

    async countActivityLogs(category: string, level: string): Promise<number> {
      let sql = "SELECT COUNT(*) FROM activity_logs WHERE 1=1";
      const args: unknown[] = [];
      const add = (value: unknown) => {
        args.push(value);
        return `$${args.length}`;
      };
      if (category.trim()) sql += ` AND category = ${add(category.trim())}`;
      if (level.trim()) sql += ` AND level = ${add(normalizeActivityLevel(level))}`;
      const row = await queryOne<[number]>(pool, sql, args);
      return row ? asNumber(row[0]) : 0;
    },

    async deleteAllActivityLogs(): Promise<number> {
      return exec(pool, "DELETE FROM activity_logs");
    },

    async trimActivityLogs(maxCount: number): Promise<number> {
      if (maxCount < 0) throw new Error("maxCount must be non-negative");
      const count = await this.countActivityLogs("", "");
      if (count <= maxCount) return 0;
      return exec(
        pool,
        `DELETE FROM activity_logs WHERE id IN (
          SELECT id FROM activity_logs ORDER BY created_at ASC, id ASC LIMIT $1
        )`,
        [count - maxCount],
      );
    },

    async getActivityLog(id: number): Promise<ActivityLog | null> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT ${ACTIVITY_LOG_SELECT} FROM activity_logs WHERE id = $1`,
        [id],
      );
      return row ? scanActivityLog(row) : null;
    },
  };
}
