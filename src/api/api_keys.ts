import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Context } from "hono";
import { record } from "../activity/index.js";
import { API_KEY_PREFIX, MAX_API_KEYS } from "../store/types.js";
import { getID, readJsonBody, writeError, writeJson, type ApiContext } from "./context.js";

const MAX_NAME_LENGTH = 64;

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isApiKey(raw: string): boolean {
  return raw.startsWith(API_KEY_PREFIX);
}

export function apiKeyDisplayPrefix(raw: string): string {
  return raw.slice(0, API_KEY_PREFIX.length + 4);
}

export function apiKeysApi(ctx: ApiContext) {
  return {
    async listApiKeys(c: Context): Promise<Response> {
      try {
        const api_keys = await ctx.db.listApiKeys();
        return writeJson(c, 200, { api_keys });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async createApiKey(c: Context): Promise<Response> {
      const body = await readJsonBody<{ name?: unknown }>(c);
      if (!body) return writeError(c, 400, "invalid request body");
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return writeError(c, 400, "name is required");
      if (name.length > MAX_NAME_LENGTH) {
        return writeError(c, 400, `name must be at most ${MAX_NAME_LENGTH} characters`);
      }

      try {
        const count = await ctx.db.countApiKeys();
        if (count >= MAX_API_KEYS) {
          return writeError(c, 400, `API Key 最多 ${MAX_API_KEYS} 个`);
        }
        const raw = generateApiKey();
        const prefix = apiKeyDisplayPrefix(raw);
        const created = await ctx.db.createApiKey({
          id: randomUUID(),
          name,
          key_hash: hashApiKey(raw),
          prefix,
        });
        record(ctx.db, {
          level: "info",
          category: "system",
          action: "api_key_created",
          message: `已创建 API Key「${name}」（${prefix}…）`,
          resourceType: "api_key",
          resourceId: created.id,
          source: "api",
        });
        return writeJson(c, 201, { ...created, key: raw });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async deleteApiKey(c: Context): Promise<Response> {
      const id = getID(c);
      if (!id) return writeError(c, 400, "id is required");
      try {
        const deleted = await ctx.db.deleteApiKey(id);
        if (!deleted) return writeError(c, 404, "api key not found");
        record(ctx.db, {
          level: "info",
          category: "system",
          action: "api_key_deleted",
          message: `已删除 API Key（${id}）`,
          resourceType: "api_key",
          resourceId: id,
          source: "api",
        });
        return writeJson(c, 200, { deleted: true });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
