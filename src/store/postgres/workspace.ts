import type { Pool } from "pg";
import type { WorkspaceStore } from "../interfaces.js";
import type { Workspace } from "../types.js";
import { asString, queryOne } from "./sql.js";

export function workspaceRepo(pool: Pool): WorkspaceStore {
  return {
    async getWorkspace(): Promise<Workspace | null> {
      const row = await queryOne<unknown[]>(
        pool,
        `SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(description,''),
           COALESCE(user_id,''), COALESCE(created_at,'')
         FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1`,
      );
      if (!row) return null;
      return {
        id: asString(row[0]),
        name: asString(row[1]),
        description: asString(row[2]),
        user_id: asString(row[3]),
        created_at: asString(row[4]),
      };
    },

    async upsertWorkspace(workspace: Workspace): Promise<void> {
      if (!workspace) throw new Error("nil workspace");
      const rows = await queryOne<unknown[]>(
        pool,
        `INSERT INTO workspace (id, name, description, user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description
         RETURNING id, created_at`,
        [workspace.id, workspace.name, workspace.description, workspace.user_id],
      );
      if (!rows) throw new Error("upsert workspace: no row returned");
      workspace.id = asString(rows[0]);
      workspace.created_at = asString(rows[1]);
    },
  };
}
