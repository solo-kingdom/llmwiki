import type { MiddlewareHandler } from "hono";

export interface AuthOptions {
  publicWiki: boolean;
}

export function bearerAuth(
  resolveToken: () => Promise<string> | string,
  options: AuthOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const token = await resolveToken();
    if (!token) {
      await next();
      return;
    }

    const path = c.req.path;
    if (path === "/api/v1/health" || path === "/api/public/wiki/status") {
      await next();
      return;
    }
    if (options.publicWiki && path.startsWith("/api/public/wiki/")) {
      await next();
      return;
    }

    const header = c.req.header("authorization") ?? "";
    const prefix = "Bearer ";
    const provided = header.startsWith(prefix) ? header.slice(prefix.length) : "";
    if (!timingSafeEqual(provided, token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
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
