import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { apiAccessLogsRepo } from "./api_access_logs.js";
import { MIGRATIONS } from "./migrations.js";

describe("Postgres api_access_logs migration & repo", () => {
  it("defines migration v13 for api_access_logs without cascade FK on api_key_id", () => {
    const v13 = MIGRATIONS.find((m) => m.version === 13);
    expect(v13).toBeDefined();
    const ddl = v13!.statements.join("\n");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS api_access_logs");
    expect(ddl).toContain("api_key_id TEXT");
    expect(ddl).not.toContain("REFERENCES api_keys");
    expect(ddl).toContain("idx_api_access_logs_occurred");
    expect(ddl).toContain("idx_api_access_logs_route_occurred");
    expect(ddl).toContain("idx_api_access_logs_status_occurred");
    expect(ddl).toContain("idx_api_access_logs_key_occurred");
  });

  it("batches inserts and purges expired rows with LIMIT 5000", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 2 }));
    const pool = { query } as unknown as Pool;
    const repo = apiAccessLogsRepo(pool);

    await repo.insertApiAccessLogs([
      {
        occurred_at: "2026-11-28T10:00:00.000Z",
        method: "GET",
        route_template: "/api/v1/settings",
        status_code: 200,
        duration_ms: 12,
        auth_type: "session",
        auth_outcome: "ok",
      },
      {
        occurred_at: "2026-11-28T10:00:01.000Z",
        method: "POST",
        route_template: "/api/v1/documents",
        status_code: 401,
        duration_ms: 3,
        auth_type: "invalid_key",
        api_key_prefix: "llmwiki_sk_bad1",
        auth_outcome: "unauthorized_401",
      },
    ]);

    expect(query).toHaveBeenCalledTimes(1);
    const [insertSql, insertParams] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(insertSql).toContain("INSERT INTO api_access_logs");
    expect(insertParams).toHaveLength(28);

    const purged = await repo.purgeExpiredApiAccessLogs("2026-10-29T00:00:00.000Z", 5000);
    expect(purged).toBe(2);
    const [purgeSql, purgeParams] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(purgeSql).toContain("DELETE FROM api_access_logs");
    expect(purgeSql).toContain("LIMIT $2");
    expect(purgeParams).toEqual(["2026-10-29T00:00:00.000Z", 5000]);
  });
});
