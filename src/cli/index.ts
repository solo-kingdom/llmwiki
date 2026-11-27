#!/usr/bin/env node
import { Command } from "commander";
import { resolveDatabaseUrl } from "../config.js";
import { runCleanupLegacy } from "./cleanup_legacy.js";
import { runClusterPlan } from "./cluster_plan.js";
import { runDedupArchives } from "./dedup_archives.js";
import { runEmbed } from "./embed.js";
import { runExport } from "./export.js";
import { runIngest } from "./ingest.js";
import { runInit } from "./init.js";
import { runLint } from "./lint.js";
import { runMcp } from "./mcp.js";
import { runMcpConfig } from "./mcp-config.js";
import { runMigrateReferences } from "./migrate_references.js";
import { runMigrateStructure } from "./migrate_structure.js";
import { runReindex } from "./reindex.js";
import { runServe } from "./serve.js";
import { runVersion } from "./version.js";

const program = new Command();

program
  .name("llmwiki")
  .description(
    "LLM Wiki — personal knowledge workspace. Incrementally build and maintain a structured wiki from source documents.",
  )
  .version("0.0.0")
  .option("--database-url <url>", "PostgreSQL DSN (default: $LLMWIKI_DATABASE_URL)");

function databaseUrl(): string | undefined {
  return program.opts<{ databaseUrl?: string }>().databaseUrl;
}

program
  .command("init [dir]")
  .description("Initialize a PostgreSQL-backed workspace")
  .option("--name <name>", "Workspace name (default: directory name or 'default')")
  .action(async (dir: string | undefined, opts: { name?: string }) => {
    await runInit(dir, opts.name, databaseUrl());
  });

program
  .command("serve [dir]")
  .description("Start the HTTP API server with embedded web UI")
  .option("--bind <addr>", "Bind address", "127.0.0.1")
  .option("--port <port>", "HTTP port", "8868")
  .option("--token <token>", "API token for authentication (optional)")
  .option("--public-wiki", "Enable public read-only Wiki at /wiki and /api/public/wiki/*", false)
  .option("--no-mcp", "Disable MCP server")
  .option("--mcp-allow-write", "Allow MCP write/delete tools for remote agents", false)
  .action(async (dir: string | undefined, opts: Record<string, unknown>) => {
    const port = Number.parseInt(String(opts.port ?? "8868"), 10);
    await runServe({
      bindAddr: String(opts.bind ?? "127.0.0.1"),
      port: Number.isFinite(port) ? port : 8868,
      token: String(opts.token ?? ""),
      publicWiki: Boolean(opts.publicWiki),
      noMcp: opts.mcp === false,
      mcpAllowWrite: Boolean(opts.mcpAllowWrite),
      workspace: dir ?? "",
      databaseUrl: resolveDatabaseUrl(databaseUrl()),
      webRoot: process.env.LLMWIKI_WEB_ROOT ?? "web/dist",
    });
  });

program
  .command("lint [dir]")
  .description("Check wiki content health against PostgreSQL (or a local directory if [dir] is provided)")
  .option("--json", "Output LintReport as JSON", false)
  .action(async (dir: string | undefined, opts: { json?: boolean }) => {
    await runLint(dir, Boolean(opts.json), databaseUrl());
  });

program
  .command("reindex")
  .description("Rebuild chunks and references from PostgreSQL content")
  .action(async () => {
    await runReindex(databaseUrl());
  });

program
  .command("ingest <file>")
  .description("Ingest a source file into the workspace")
  .option("--force-overwrite", "Skip merge protection and overwrite existing wiki pages", false)
  .action(async (file: string, opts: { forceOverwrite?: boolean }) => {
    await runIngest(file, Boolean(opts.forceOverwrite), databaseUrl());
  });

program
  .command("mcp [dir]")
  .description("Run MCP JSON-RPC 2.0 server on stdin/stdout (legacy local mode)")
  .action(async (dir: string | undefined) => {
    await runMcp(dir, databaseUrl());
  });

program
  .command("mcp-config [dir]")
  .description("Print MCP configuration JSON for HTTP RPC endpoint")
  .option("--port <port>", "HTTP port of llmwiki serve", "8868")
  .option("--bind <addr>", "Bind address of llmwiki serve", "127.0.0.1")
  .option("--token <token>", "Bearer token for remote MCP authentication")
  .action((dir: string | undefined, opts: Record<string, unknown>) => {
    runMcpConfig(
      dir,
      String(opts.bind ?? "127.0.0.1"),
      Number.parseInt(String(opts.port ?? "8868"), 10),
      String(opts.token ?? ""),
    );
  });

program
  .command("export")
  .description("Export pages from PostgreSQL to a directory")
  .requiredOption("--out <dir>", "Output directory (required)")
  .option("--include-raw", "Also export stored archive files and legacy source blobs", false)
  .option("--with-index", "Generate a static wiki/index.md in the export directory", false)
  .action(async (opts: { out: string; includeRaw?: boolean; withIndex?: boolean }) => {
    await runExport(opts.out, Boolean(opts.includeRaw), databaseUrl(), Boolean(opts.withIndex));
  });

program
  .command("embed")
  .description("Backfill chunk embeddings with the configured embedding model")
  .option("--batch <n>", "Chunks per embedding request", "32")
  .action(async (opts: { batch?: string }) => {
    const batch = Number.parseInt(String(opts.batch ?? "32"), 10);
    await runEmbed(Number.isFinite(batch) ? batch : 32, databaseUrl());
  });

program
  .command("migrate-references")
  .description("Extract trailing reference sections from stored wiki pages into document_reference_entries and strip them from content")
  .option("--dry-run", "Report what would change without writing")
  .action(async (opts: { dryRun?: boolean }) => {
    await runMigrateReferences(opts, databaseUrl());
  });

program
  .command("migrate-structure")
  .description("Validate or apply a structure migration manifest against PostgreSQL")
  .requiredOption("--manifest <file>", "Migration manifest JSON (required)")
  .option("--dry-run", "Validate only without writing", false)
  .option("--apply", "Apply validated migration to PostgreSQL", false)
  .option("--batch <name>", "Filter manifest entries by batch name")
  .option("--reverse-out <file>", "Write reverse-migration manifest JSON after --apply")
  .action(async (opts: { manifest?: string; dryRun?: boolean; apply?: boolean; batch?: string; reverseOut?: string }) => {
    await runMigrateStructure(opts, databaseUrl());
  });

program
  .command("cluster-plan")
  .description("Generate deterministic sub-folder clustering manifest for overcrowded wiki folders")
  .option("--folder <path>", "Target wiki folder path (default: all overcrowded wiki folders)")
  .option("--threshold <n>", "Overcrowded threshold", (v) => Number.parseInt(v, 10), 20)
  .option("--min-cluster-size <n>", "Minimum documents per cluster", (v) => Number.parseInt(v, 10), 3)
  .option("--out <file>", "Write JSON manifest to file instead of stdout")
  .action(async (opts: { folder?: string; threshold?: number; minClusterSize?: number; out?: string }) => {
    await runClusterPlan(opts, databaseUrl());
  });

program
  .command("dedup-archives")
  .description("Find and merge duplicate archive files sharing identical sha256 hashes")
  .option("--dry-run", "Report duplicate groups without writing", false)
  .option("--apply", "Merge duplicates, transfer links, and restore canonical filenames", false)
  .action(async (opts: { dryRun?: boolean; apply?: boolean }) => {
    await runDedupArchives(opts, databaseUrl());
  });

program
  .command("cleanup-legacy")
  .description("Find and delete legacy system pages (wiki/log.md, wiki/index.md, wiki/templates/*) from PostgreSQL")
  .option("--dry-run", "Report matching legacy pages without deleting (default)", false)
  .option("--apply", "Delete matching legacy pages via change_sets", false)
  .action(async (opts: { dryRun?: boolean; apply?: boolean }) => {
    await runCleanupLegacy(opts, databaseUrl());
  });

program
  .command("version")
  .description("Print version information")
  .action(() => {
    runVersion();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
