import path from "node:path";
import { serve } from "@hono/node-server";
import { AcpManager } from "../acp/manager.js";
import {
  DEFAULT_MAX_CONCURRENT_AGENTS,
  MAX_CONCURRENT_AGENTS,
  MIN_CONCURRENT_AGENTS,
} from "../acp/config.js";
import { createApiContext, mcpActivity } from "../api/context.js";
import { trimActivityLogs } from "../api/settings.js";
import { ArchiveStorageService } from "../archive/storage.js";
import { WorkspaceFileIndexer } from "../engine/file_indexer.js";
import { engineStoreFromStore } from "../engine/adapter.js";
import { PageLockManager } from "../ingest/lock.js";
import { JobProcessor } from "../ingest/processor.js";
import { logger } from "../logger.js";
import { McpServer } from "../mcp/server.js";
import { defaultToolPolicy } from "../mcp/policy.js";
import { createAuditAdapter, registerTools } from "../mcp/tools.js";
import { openDatabase } from "../db/pool.js";
import { loadSnapshot } from "../llm/provider_snapshot.js";
import { CATALOG_SYNC_INTERVAL_MS, isCatalogStale, syncModelsDev } from "../llm/provider_sync.js";
import { openStore } from "../store/postgres/db.js";
import { importSettingsIfEmpty } from "../workspace/settings.js";
import { createApp } from "../server/app.js";
import type { ServeOptions } from "../config.js";
import { isLoopback, resolveWorkspaceDir } from "./workspace.js";

export async function runServe(options: ServeOptions): Promise<void> {
  const workspace = resolveWorkspaceDir(options.workspace);
  const pool = openDatabase(options.databaseUrl);
  const store = await openStore(pool);

  try {
    await importSettingsIfEmpty(store, workspace);

    try {
      if (await store.cacheIsEmpty()) {
        const { providers, models } = loadSnapshot();
        if (providers.length > 0) await store.upsertProviderInfo(providers);
        if (models.length > 0) await store.upsertModels(models);
        logger.info(`loaded built-in provider snapshot: ${providers.length} providers, ${models.length} models`);
      }
    } catch (error) {
      logger.error(`load provider snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const rawMax = await store.getConfig("acp_max_concurrent_agents");
    let maxConcurrent = DEFAULT_MAX_CONCURRENT_AGENTS;
    const parsedMax = Number.parseInt(rawMax, 10);
    if (
      Number.isFinite(parsedMax) &&
      parsedMax >= MIN_CONCURRENT_AGENTS &&
      parsedMax <= MAX_CONCURRENT_AGENTS
    ) {
      maxConcurrent = parsedMax;
    }
    const acpManager = new AcpManager(maxConcurrent);

    if (!options.noMcp && !isLoopback(options.bindAddr) && !options.token) {
      throw new Error(
        `remote MCP security: --token is required when binding to non-loopback address "${options.bindAddr}".\n` +
          "Use --no-mcp to disable MCP or set --token <secret>",
      );
    }

    const lockMgr = new PageLockManager();
    const adapter = engineStoreFromStore(store);
    const indexer = new WorkspaceFileIndexer(adapter, workspace);
    const apiCtx = createApiContext({ db: store, workspace, lockMgr, indexer });

    let mcpServer: McpServer | null = null;
    if (!options.noMcp) {
      mcpServer = new McpServer(
        "LLM Wiki",
        "You are connected to an LLM Wiki workspace. Call the `guide` tool first to see available knowledge bases and learn the full workflow.",
      );
      const activity = mcpActivity(apiCtx);
      registerTools(mcpServer, workspace, store, indexer, activity);
      mcpServer.setToolPolicy(defaultToolPolicy(options.mcpAllowWrite));
      mcpServer.setAuditDb(createAuditAdapter(store, activity));
    }

    const app = createApp({
      db: store,
      token: options.token,
      publicWiki: options.publicWiki,
      noMcp: options.noMcp,
      mcpAllowWrite: options.mcpAllowWrite,
      workspace,
      webRoot: options.webRoot,
      skillsRoot: process.env.LLMWIKI_SKILLS_ROOT ?? path.resolve("skills"),
      acpManager,
      lockMgr,
      indexer,
      mcpServer,
    });

    // Jobs and the HTTP API write the same wiki pages, so they queue on one lock manager.
    const processor = new JobProcessor(store, workspace, { lockManager: lockMgr });
    processor.start(2000);

    void new ArchiveStorageService(store, workspace)
      .backfillSearchableText(200)
      .catch((error) => {
        logger.warn({ error }, "archive searchable_text backfill");
      });

    const trimTimer = setInterval(() => {
      void trimActivityLogs(apiCtx).catch((error) => {
        logger.warn({ error }, "activity logs trim");
      });
    }, 5 * 60 * 1000);

    const runCatalogSyncIfStale = async () => {
      try {
        const syncedAt = await store.getConfig("models_synced_at");
        if (!isCatalogStale(syncedAt)) return;
        await syncModelsDev(store);
      } catch (error) {
        logger.warn(
          `models.dev catalog sync failed (using cached/snapshot data): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    void runCatalogSyncIfStale();
    const catalogSyncTimer = setInterval(() => {
      void runCatalogSyncIfStale();
    }, CATALOG_SYNC_INTERVAL_MS);
    catalogSyncTimer.unref?.();

    const server = serve(
      {
        fetch: app.fetch,
        hostname: options.bindAddr,
        port: options.port,
      },
      (info) => {
        logger.info(
          `LLM Wiki server starting on http://${info.address}:${info.port} (single-process: API + Web + MCP RPC)`,
        );
      },
    );

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`received ${signal}, shutting down`);
      clearInterval(trimTimer);
      clearInterval(catalogSyncTimer);
      processor.stop();
      acpManager.closeAll();
      server.close();
      await pool.end();
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}
