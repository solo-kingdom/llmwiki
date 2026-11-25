import type { Context, MiddlewareHandler } from "hono";
import { hashApiKey, isApiKey } from "../api/api_keys.js";
import { API_KEY_PREFIX, type ApiKeyRecord } from "../store/types.js";

export type AuthKind = "none" | "legacy_token" | "api_key";

export interface AuthContext {
  kind: AuthKind;
  keyId?: string;
  keyName?: string;
}

export interface AuthOptions {
  publicWiki: boolean;
  findApiKeyByHash?: (keyHash: string) => Promise<ApiKeyRecord | null>;
  touchApiKey?: (id: string) => Promise<void>;
}

const requestAuthMap = new WeakMap<Request, AuthContext>();

export function getAuthContext(c: Context): AuthContext {
  return requestAuthMap.get(c.req.raw) ?? { kind: "none" };
}

export function isApiKeyRequest(c: Context): boolean {
  return getAuthContext(c).kind === "api_key";
}

function isPublicPath(reqPath: string, options: AuthOptions): boolean {
  if (
    reqPath === "/api/v1/health" ||
    reqPath === "/api/public/wiki/status" ||
    reqPath === "/skill.md" ||
    reqPath === "/api/v1/skills" ||
    reqPath.startsWith("/skills/")
  ) {
    return true;
  }
  if (options.publicWiki && reqPath.startsWith("/api/public/wiki/")) {
    return true;
  }
  return false;
}

function isCredentialManagementPath(reqPath: string): boolean {
  return reqPath === "/api/v1/api-keys" || reqPath.startsWith("/api/v1/api-keys/");
}

export function bearerAuth(
  resolveToken: () => Promise<string> | string,
  options: AuthOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const reqPath = c.req.path;
    if (isPublicPath(reqPath, options)) {
      await next();
      return;
    }

    const header = c.req.header("authorization") ?? "";
    if (header) {
      const prefix = "Bearer ";
      if (!header.startsWith(prefix)) {
        return c.json({ error: "unauthorized" }, 401);
      }
      const provided = header.slice(prefix.length).trim();
      if (!provided) {
        return c.json({ error: "unauthorized" }, 401);
      }

      if (isApiKey(provided)) {
        if (provided.length < API_KEY_PREFIX.length + 20 || !options.findApiKeyByHash) {
          return c.json({ error: "unauthorized" }, 401);
        }
        const record = await options.findApiKeyByHash(hashApiKey(provided));
        if (!record) {
          return c.json({ error: "unauthorized" }, 401);
        }
        requestAuthMap.set(c.req.raw, {
          kind: "api_key",
          keyId: record.id,
          keyName: record.name,
        });
        if (options.touchApiKey) {
          void options.touchApiKey(record.id).catch(() => {
            // last_used_at is best-effort display metadata
          });
        }
        if (isCredentialManagementPath(reqPath)) {
          return c.json({ error: "api key cannot manage credentials" }, 403);
        }
        await next();
        return;
      }

      const token = await resolveToken();
      if (!token || !timingSafeEqual(provided, token)) {
        return c.json({ error: "unauthorized" }, 401);
      }
      requestAuthMap.set(c.req.raw, { kind: "legacy_token" });
      await next();
      return;
    }

    const token = await resolveToken();
    if (!token) {
      requestAuthMap.set(c.req.raw, { kind: "none" });
      await next();
      return;
    }

    return c.json({ error: "unauthorized" }, 401);
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
