import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { parseConfig, hasEnabledAgent } from "../acp/config.js";
import type { AcpManager } from "../acp/manager.js";
import { record } from "../activity/index.js";
import { createApi, createApiContext } from "../api/index.js";
import { writeError } from "../api/context.js";
import { rebuildDerived } from "../ingest/rebuild.js";
import type { PageLockManager } from "../ingest/lock.js";
import type { WorkspaceFileIndexer } from "../engine/file_indexer.js";
import type { McpServer } from "../mcp/server.js";
import type { Store } from "../store/interfaces.js";
import { CONFIG_API_TOKEN } from "../store/types.js";
import { bearerAuth } from "./auth.js";
import { healthHandler } from "./health.js";

export interface AppDeps {
  db: Store;
  token: string;
  publicWiki: boolean;
  noMcp: boolean;
  mcpAllowWrite: boolean;
  workspace: string;
  webRoot: string;
  skillsRoot: string;
  acpManager?: AcpManager | null;
  lockMgr?: PageLockManager | null;
  indexer?: WorkspaceFileIndexer | null;
  mcpServer?: McpServer | null;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono({ strict: false });
  const api = createApi(
    createApiContext({
      db: deps.db,
      workspace: deps.workspace,
      lockMgr: deps.lockMgr ?? null,
      indexer: deps.indexer ?? null,
      publicWikiEnabled: deps.publicWiki,
      acpMgr: deps.acpManager ?? null,
      flagToken: deps.token,
    }),
  );

  async function effectiveToken(): Promise<string> {
    if (deps.token) return deps.token;
    try {
      return await deps.db.getConfig(CONFIG_API_TOKEN);
    } catch {
      return "";
    }
  }

  async function acpEnabled(): Promise<boolean> {
    try {
      return hasEnabledAgent(parseConfig(await deps.db.getConfig("acp_agents_json")));
    } catch {
      return false;
    }
  }

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Accept", "Authorization", "Content-Type"],
      exposeHeaders: ["Link"],
      credentials: true,
      maxAge: 300,
    }),
  );

  app.use("*", bearerAuth(effectiveToken, { publicWiki: deps.publicWiki }));

  // Mirrors the Go server's timeoutUnlessStream: normal requests get 60s, SSE streams do not.
  app.use("*", async (c, next) => {
    if (isStreamingRequest(c.req.method, c.req.path, c.req.query("stream"), c.req.header("accept") ?? "")) {
      await next();
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<Response>((resolve) => {
      timer = setTimeout(() => resolve(c.json({ error: "request timeout" }, 504)), 60_000);
    });
    try {
      const timedOut = await Promise.race([next().then(() => null), timeout]);
      if (timedOut) return timedOut;
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  app.get(
    "/api/v1/health",
    healthHandler(async () => ({
      mcpEnabled: !deps.noMcp,
      authRequired: (await effectiveToken()) !== "",
      mcpAllowWrite: deps.mcpAllowWrite,
      acpEnabled: await acpEnabled(),
    })),
  );

  // Public wiki (read-only)
  app.get("/api/public/wiki/status", api.publicWikiStatus);
  app.get("/api/public/wiki/documents", api.listPublicWikiDocuments);
  app.get("/api/public/wiki/documents/:id", api.getPublicWikiDocument);
  app.get("/api/public/wiki/search", api.searchPublicWiki);

  // Workspace and system
  app.get("/api/v1/workspace", api.getWorkspace);
  app.get("/api/v1/skills", (c) => skillIndex(c, deps.skillsRoot));
  app.post("/api/v1/reindex", async (c) => {
    if (c.req.method !== "POST") return c.json({ error: "method not allowed" }, 405);
    const before = await deps.db.countActivityLogs("", "");
    record(deps.db, {
      level: "info",
      category: "system",
      action: "reindex_started",
      message: "开始重建索引",
      source: "api",
    });
    try {
      const indexed = await rebuildDerived(deps.db);
      const after = await deps.db.countActivityLogs("", "");
      record(deps.db, {
        level: "info",
        category: "system",
        action: "reindex_completed",
        message: `索引重建完成，共处理 ${indexed} 个文档`,
        status: "success",
        source: "api",
        details: { indexed_count: indexed, activity_logs_kept: after === before },
      });
      return c.json({ indexed, status: "ok" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record(deps.db, {
        level: "error",
        category: "system",
        action: "reindex_completed",
        message: `索引重建失败：${message}`,
        status: "failure",
        source: "api",
        details: { error: message },
      });
      return c.json({ error: message }, 500);
    }
  });

  // Documents
  app.get("/api/v1/documents", api.listDocuments);
  app.post("/api/v1/documents", api.createDocument);
  app.post("/api/v1/documents/bulk-delete", api.bulkDeleteDocuments);
  app.get("/api/v1/documents/:id", api.getDocument);
  app.get("/api/v1/documents/:id/content", api.getDocumentContent);
  app.put("/api/v1/documents/:id/content", api.updateDocumentContent);
  app.patch("/api/v1/documents/:id", api.updateDocumentMetadata);
  app.delete("/api/v1/documents/:id", api.deleteDocument);

  // Search, lint, graph
  app.get("/api/v1/search", api.search);
  app.get("/api/v1/lint", api.lint);
  app.get("/api/v1/graph", api.knowledgeGraph);
  app.get("/api/v1/graph/backlinks/:id", api.backlinks);
  app.get("/api/v1/graph/forward/:id", api.forwardReferences);
  app.get("/api/v1/graph/uncited", api.uncitedSources);
  app.get("/api/v1/graph/stale", api.stalePages);

  // Settings and logs
  app.get("/api/v1/settings", api.getSettings);
  app.put("/api/v1/settings", api.updateSettings);
  app.put("/api/v1/settings/last-model", api.updateLastModel);
  app.get("/api/v1/workspace/rule-files", api.getWorkspaceRuleFiles);
  app.put("/api/v1/workspace/rule-files", api.updateWorkspaceRuleFiles);
  app.get("/api/v1/logs", api.listActivityLogs);
  app.delete("/api/v1/logs", api.deleteAllActivityLogs);
  app.get("/api/v1/capabilities", api.getCapabilities);
  app.post("/api/v1/settings/mcp/check", api.checkMcpStatus);

  // History and revisions
  app.get("/api/v1/history", api.listHistory);
  app.get("/api/v1/history/:id", api.getHistory);
  app.get("/api/v1/history/:id/diff", api.historyDiff);
  app.post("/api/v1/history/:id/rollback", api.rollbackHistory);
  app.get("/api/v1/pages/history", api.pageHistory);
  app.get("/api/v1/revisions/:id", api.getRevision);
  app.post("/api/v1/revisions/:id/restore", api.restoreRevision);

  // Providers and ACP
  app.get("/api/v1/providers", api.listProviders);
  app.get("/api/v1/providers/:id/models", api.listProviderModels);
  app.get("/api/v1/provider-instances", api.listProviderInstances);
  app.post("/api/v1/provider-instances", api.createProviderInstance);
  app.post("/api/v1/provider-instances/check", api.checkAllProviderInstances);
  app.get("/api/v1/provider-instances/:id", api.getProviderInstance);
  app.put("/api/v1/provider-instances/:id", api.updateProviderInstance);
  app.delete("/api/v1/provider-instances/:id", api.deleteProviderInstance);
  app.post("/api/v1/provider-instances/:id/check", api.checkProviderInstance);
  app.get("/api/v1/acp-agents", api.listAcpAgents);
  app.post("/api/v1/acp-agents/check", api.checkAcpAgents);

  // Ingest: rollback, jobs, sessions, reviews
  app.post("/api/v1/ingest/rollback", api.ingestRollback);
  app.get("/api/v1/ingest/jobs", api.listIngestJobs);
  app.get("/api/v1/ingest/jobs/:id", api.getIngestJob);
  app.get("/api/v1/ingest/jobs/:id/events", api.getIngestJobEvents);
  app.get("/api/v1/ingest/jobs/:id/source", api.getJobSource);
  app.post("/api/v1/ingest/jobs/:id/retry", api.retryIngestJob);
  app.post("/api/v1/ingest/jobs/:id/cancel", api.cancelIngestJob);
  app.post("/api/v1/ingest/jobs/:id/fail", api.markIngestJobFailed);
  app.post("/api/v1/ingest/jobs/conversation", api.createConversationIngestJob);
  app.post("/api/v1/ingest/jobs/text", api.createTextIngestJob);
  app.post("/api/v1/ingest/jobs/upload", api.createUploadIngestJobs);

  app.get("/api/v1/ingest/sessions", api.listIngestSessions);
  app.post("/api/v1/ingest/sessions", api.createIngestSession);
  app.get("/api/v1/ingest/sessions/:id", api.getIngestSession);
  app.patch("/api/v1/ingest/sessions/:id", api.updateIngestSession);
  app.delete("/api/v1/ingest/sessions/:id", api.deleteIngestSession);
  app.get("/api/v1/ingest/sessions/:id/messages", api.listIngestSessionMessages);
  app.post("/api/v1/ingest/sessions/:id/messages", api.appendIngestSessionMessage);
  app.post("/api/v1/ingest/sessions/:id/messages/:messageId/retry", api.retryIngestSessionMessage);
  app.patch("/api/v1/ingest/sessions/:id/messages/:messageId", api.patchIngestSessionMessage);
  app.get("/api/v1/ingest/sessions/:id/messages/:messageId/events", api.getSessionMessageEvents);
  app.get("/api/v1/ingest/sessions/:id/references", api.listIngestSessionReferences);
  app.post("/api/v1/ingest/sessions/:id/attachments", api.uploadIngestSessionAttachment);
  app.post("/api/v1/ingest/sessions/:id/archive", api.archiveIngestSession);

  app.get("/api/v1/ingest/reviews", api.listIngestReviews);
  app.get("/api/v1/ingest/reviews/:id", api.getIngestReview);
  app.get("/api/v1/ingest/reviews/:id/plans", api.listIngestReviewPlans);
  app.post("/api/v1/ingest/reviews/:id/feedback", api.addIngestReviewFeedback);
  app.post("/api/v1/ingest/reviews/:id/replan", api.replanIngestReview);
  app.post("/api/v1/ingest/reviews/:id/approve", api.approveIngestReview);

  // MCP RPC
  if (!deps.noMcp && deps.mcpServer) {
    app.post("/mcp", (c) => deps.mcpServer!.handleHttp(c.req.raw));
  }

  // Agent skills
  app.get("/skill.md", (c) => skillDoc(c, deps.skillsRoot, "llmwiki", "SKILL.md"));
  app.get("/skills/:file", (c) => {
    const file = c.req.param("file") ?? "";
    if (file.endsWith(".zh.md")) {
      const name = file.slice(0, -".zh.md".length);
      if (!validSkillName(name)) return c.json({ error: "invalid skill name" }, 400);
      return skillDoc(c, deps.skillsRoot, name, "SKILL.zh.md");
    }
    if (file.endsWith(".md")) {
      const name = file.slice(0, -".md".length);
      if (!validSkillName(name)) return c.json({ error: "invalid skill name" }, 400);
      return skillDoc(c, deps.skillsRoot, name, "SKILL.md");
    }
    return c.json({ error: "skill not found" }, 404);
  });

  app.all("/api/*", (c) => writeError(c, 404, "not found"));

  app.get("/*", serveStatic({ root: deps.webRoot }));
  app.get("*", serveStatic({ root: deps.webRoot, path: "index.html" }));

  return app;
}

async function skillDoc(c: Context, root: string, name: string, file: string): Promise<Response> {
  try {
    const doc = await readFile(path.join(root, name, file), "utf8");
    return new Response(doc, {
      status: 200,
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" },
    });
  } catch {
    const message = file === "SKILL.zh.md" ? `no zh translation for skill: ${name}` : `skill not found: ${name}`;
    return c.json({ error: message }, 404);
  }
}

async function skillIndex(c: Context, root: string): Promise<Response> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const skills: Array<{ name: string; description: string; lang?: string; url: string; url_zh?: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const doc = await readFile(path.join(root, entry.name, "SKILL.md"), "utf8");
        const fm = parseSkillFrontmatter(doc);
        const info: (typeof skills)[number] = {
          name: entry.name,
          description: fm.description ?? "",
          url: `/skills/${entry.name}.md`,
        };
        if (fm.lang) info.lang = fm.lang;
        try {
          await readFile(path.join(root, entry.name, "SKILL.zh.md"), "utf8");
          info.url_zh = `/skills/${entry.name}.zh.md`;
        } catch {
          // no Chinese mirror
        }
        skills.push(info);
      } catch {
        // not a skill directory
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ entry: "/skill.md", skills });
  } catch {
    return c.json({ error: "skills not found in this build" }, 404);
  }
}

function parseSkillFrontmatter(doc: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = doc.split("\n");
  if (lines.length === 0 || lines[0]?.trim() !== "---") return out;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    if (!line || line.startsWith(" ") || line.startsWith("\t") || line.startsWith("#")) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function isStreamingRequest(
  method: string,
  requestPath: string,
  streamQuery: string | undefined,
  accept: string,
): boolean {
  if (method !== "POST") return false;
  if (!requestPath.includes("/ingest/sessions/")) return false;
  const wantsStream = streamQuery === "1" || accept.includes("text/event-stream");
  if (requestPath.endsWith("/retry")) return wantsStream;
  if (!requestPath.endsWith("/messages")) return false;
  return wantsStream;
}

function validSkillName(name: string): boolean {
  if (!name || name.length > 64) return false;
  return /^[a-z0-9-]+$/.test(name);
}
