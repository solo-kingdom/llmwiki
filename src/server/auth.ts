import type { Context, MiddlewareHandler } from "hono";
import { apiKeyDisplayPrefix, hashApiKey, isApiKey } from "../api/api_keys.js";
import { API_KEY_PREFIX, type ApiAuthType, type ApiKeyRecord } from "../store/types.js";

export type AuthKind = "none" | "legacy_token" | "api_key";

export interface AuthContext {
  kind: AuthKind;
  authType?: ApiAuthType;
  keyId?: string;
  keyName?: string;
  keyPrefix?: string;
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

function isApiStatsPath(reqPath: string): boolean {
  return reqPath === "/api/v1/api-stats" || reqPath.startsWith("/api/v1/api-stats/");
}

export function bearerAuth(
  resolveToken: () => Promise<string> | string,
  options: AuthOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const reqPath = c.req.path;
    if (isPublicPath(reqPath, options)) {
      requestAuthMap.set(c.req.raw, { kind: "none", authType: "anonymous" });
      await next();
      return;
    }

    const header = c.req.header("authorization") ?? "";
    if (header) {
      const prefix = "Bearer ";
      if (!header.startsWith(prefix)) {
        requestAuthMap.set(c.req.raw, { kind: "none", authType: "invalid_key" });
        return c.json({ error: "unauthorized" }, 401);
      }
      const provided = header.slice(prefix.length).trim();
      if (!provided) {
        requestAuthMap.set(c.req.raw, { kind: "none", authType: "invalid_key" });
        return c.json({ error: "unauthorized" }, 401);
      }

      if (isApiKey(provided)) {
        const keyPrefix = apiKeyDisplayPrefix(provided);
        if (provided.length < API_KEY_PREFIX.length + 20 || !options.findApiKeyByHash) {
          requestAuthMap.set(c.req.raw, { kind: "none", authType: "invalid_key", keyPrefix });
          return c.json({ error: "unauthorized" }, 401);
        }
        const record = await options.findApiKeyByHash(hashApiKey(provided));
        if (!record) {
          requestAuthMap.set(c.req.raw, { kind: "none", authType: "invalid_key", keyPrefix });
          return c.json({ error: "unauthorized" }, 401);
        }
        requestAuthMap.set(c.req.raw, {
          kind: "api_key",
          authType: "api_key",
          keyId: record.id,
          keyName: record.name,
          keyPrefix: record.prefix,
        });
        if (options.touchApiKey) {
          void options.touchApiKey(record.id).catch(() => {
            // last_used_at is best-effort display metadata
          });
        }
        if (isCredentialManagementPath(reqPath)) {
          return c.json({ error: "api key cannot manage credentials" }, 403);
        }
        if (isApiStatsPath(reqPath)) {
          return c.json({ error: "api key cannot access api stats" }, 403);
        }
        await next();
        return;
      }

      const token = await resolveToken();
      if (!token || !timingSafeEqual(provided, token)) {
        requestAuthMap.set(c.req.raw, { kind: "none", authType: "invalid_key" });
        return c.json({ error: "unauthorized" }, 401);
      }
      requestAuthMap.set(c.req.raw, { kind: "legacy_token", authType: "session" });
      await next();
      return;
    }

    const token = await resolveToken();
    if (!token) {
      requestAuthMap.set(c.req.raw, { kind: "none", authType: "session" });
      await next();
      return;
    }

    requestAuthMap.set(c.req.raw, { kind: "none", authType: "anonymous" });
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
