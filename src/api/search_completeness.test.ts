import path from "node:path";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { registerTools } from "../mcp/tools.js";
import { executeLocalSearch } from "../mcp/local_tools.js";
import { defaultToolPolicy, toolPolicyAllows } from "../mcp/policy.js";
import { McpServer } from "../mcp/server.js";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import { archivesRepo } from "../store/postgres/archives.js";
import {
  chunksRepo,
  extractMatchedLines,
  SearchValidationError,
  validateSearchRegex,
} from "../store/postgres/chunks.js";
import type { ArchiveFile, ArchiveSearchHit, SearchChunk } from "../store/types.js";

function makeChunk(overrides: Partial<SearchChunk> = {}): SearchChunk {
  return {
    document_id: "doc-1",
    content: "Line 1\nRetryPolicy backoff=200ms\nLine 3",
    page: 1,
    header_breadcrumb: "Config",
    chunk_index: 0,
    filename: "retry.md",
    title: "Retry Policy",
    path: "/wiki/engineering/resilience/",
    file_type: "md",
    page_type: "concept",
    score: 0.9,
    updated_at: "2026-11-28 10:00:00",
    tags: ["resilience", "http"],
    ...overrides,
  };
}

function makeArchiveFile(overrides: Partial<ArchiveFile> = {}): ArchiveFile {
  return {
    id: "af-1",
    folder_path: "specs/v1",
    filename: "gateway.md",
    title: "Gateway Spec",
    relative_path: "specs/v1/gateway.md",
    media_type: "text/markdown",
    kind: "markdown",
    size: 120,
    sha256: "abc123",
    storage_backend: "db",
    storage_key: "",
    origin: "upload",
    source_ref: "",
    ingest_job_id: "",
    created_at: "2026-11-27 10:00:00",
    updated_at: "2026-11-28 10:00:00",
    ...overrides,
  };
}

describe("search validation & matched_lines helpers", () => {
  it("validates regex patterns and rejects invalid or overly long regex", () => {
    expect(() => validateSearchRegex("backoff=\\d+")).not.toThrow();
    expect(() => validateSearchRegex("")).toThrow(SearchValidationError);
    expect(() => validateSearchRegex("[unclosed")).toThrow(SearchValidationError);
    expect(() => validateSearchRegex("a".repeat(257))).toThrow(SearchValidationError);
  });

  it("extracts 1-based matched_lines for phrase and regex with case sensitivity", () => {
    const content = "first line\nRetryPolicy = 3\nretryPolicy = 5\nlast line";
    const ciPhrase = extractMatchedLines(content, "retrypolicy", "phrase", false);
    expect(ciPhrase).toEqual([
      { line: 2, text: "RetryPolicy = 3" },
      { line: 3, text: "retryPolicy = 5" },
    ]);

    const csPhrase = extractMatchedLines(content, "RetryPolicy", "phrase", true);
    expect(csPhrase).toEqual([{ line: 2, text: "RetryPolicy = 3" }]);

    const regexHits = extractMatchedLines(content, "Policy = \\d+", "regex", false);
    expect(regexHits).toHaveLength(2);
    expect(regexHits[0]?.line).toBe(2);
  });
});

describe("GET /api/v1/search completeness", () => {
  it("supports scope=wiki|archives|all, filters, pagination, and surfaces hybrid degradation", async () => {
    const chunkA = makeChunk({
      document_id: "doc-a",
      filename: "a.md",
      title: "Page A",
      updated_at: "2026-11-26 10:00:00",
    });
    const chunkB = makeChunk({
      document_id: "doc-b",
      filename: "b.md",
      title: "Page B",
      updated_at: "2026-11-28 12:00:00",
    });
    const archiveHit: ArchiveSearchHit = {
      file: makeArchiveFile(),
      match_type: "title",
      snippet: "Gateway Spec",
      score: 1.8,
    };

    const searchChunks = vi.fn(async () => [chunkA, chunkB]);
    const searchArchiveFiles = vi.fn(async () => [archiveHit]);
    const getConfig = vi.fn(async () => "");

    const app = createApp({
      db: {
        searchChunks,
        searchArchiveFiles,
        getConfig,
        listProviderInstances: vi.fn(async () => []),
      } as unknown as Store,
      token: "",
      publicWiki: true,
      noMcp: true,
      mcpAllowWrite: false,
      workspace: "",
      webRoot: "/tmp/nonexistent-web",
      skillsRoot: path.resolve(process.cwd(), "skills"),
    });

    // scope=wiki with degradation transparency, sort=updated_desc, pagination
    const wikiRes = await app.request(
      "/api/v1/search?q=backoff&folder=engineering&tags=resilience,http&tag_mode=all&match=all_terms&sort=updated_desc&limit=1&offset=0",
    );
    expect(wikiRes.status).toBe(200);
    const wikiBody = (await wikiRes.json()) as {
      scope: string;
      mode: string;
      effective_mode: string;
      degraded_reason?: string;
      results: SearchChunk[];
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
    };
    expect(wikiBody.scope).toBe("wiki");
    expect(wikiBody.mode).toBe("hybrid");
    expect(wikiBody.effective_mode).toBe("keyword");
    expect(wikiBody.degraded_reason).toContain("embedding unavailable");
    expect(wikiBody.total).toBe(2);
    expect(wikiBody.has_more).toBe(true);
    expect(wikiBody.results[0]?.document_id).toBe("doc-b");
    expect(wikiBody.results[0]?.relative_path).toBe("wiki/engineering/resilience/b.md");
    expect(searchChunks).toHaveBeenCalledWith(
      "backoff",
      expect.any(Number),
      "wiki",
      expect.objectContaining({
        folder: "engineering",
        tags: ["resilience", "http"],
        tag_mode: "all",
        match: "all_terms",
        sort: "updated_desc",
      }),
    );

    // scope=archives
    const archRes = await app.request("/api/v1/search?q=gateway&scope=archives&unlinked_only=true");
    expect(archRes.status).toBe(200);
    const archBody = (await archRes.json()) as {
      scope: string;
      results: SearchChunk[];
      archive_results: ArchiveSearchHit[];
      archive_total: number;
    };
    expect(archBody.scope).toBe("archives");
    expect(archBody.results).toEqual([]);
    expect(archBody.archive_total).toBe(1);
    expect(archBody.archive_results[0]?.file.relative_path).toBe("specs/v1/gateway.md");

    // scope=all
    const allRes = await app.request("/api/v1/search?q=gateway&scope=all&mode=keyword");
    expect(allRes.status).toBe(200);
    const allBody = (await allRes.json()) as {
      scope: string;
      effective_mode: string;
      results: SearchChunk[];
      archive_results: ArchiveSearchHit[];
    };
    expect(allBody.scope).toBe("all");
    expect(allBody.effective_mode).toBe("keyword");
    expect(allBody.results).toHaveLength(2);
    expect(allBody.archive_results).toHaveLength(1);

    // Invalid regex -> 400
    const badRegex = await app.request("/api/v1/search?q=%5Bunclosed&match=regex");
    expect(badRegex.status).toBe(400);

    // Invalid scope -> 400
    const badScope = await app.request("/api/v1/search?q=test&scope=invalid");
    expect(badScope.status).toBe(400);
  });
});

describe("GET /api/v1/archives/search completeness", () => {
  it("does not run synchronous backfill on query hot path and supports new filters + pagination", async () => {
    const listArchiveFilesMissingSearchText = vi.fn(async () => []);
    const hits: ArchiveSearchHit[] = [
      { file: makeArchiveFile({ id: "af-1" }), match_type: "title", snippet: "s1", score: 2 },
      { file: makeArchiveFile({ id: "af-2" }), match_type: "content", snippet: "s2", score: 1 },
    ];
    const searchArchiveFiles = vi.fn(async () => hits);

    const app = createApp({
      db: {
        listArchiveFilesMissingSearchText,
        searchArchiveFiles,
      } as unknown as Store,
      token: "",
      publicWiki: true,
      noMcp: true,
      mcpAllowWrite: false,
      workspace: "",
      webRoot: "/tmp/nonexistent-web",
      skillsRoot: path.resolve(process.cwd(), "skills"),
    });

    const res = await app.request(
      "/api/v1/archives/search?q=gateway&match=phrase&case_sensitive=true&origin=upload&media_type=markdown&unlinked_only=true&limit=1&offset=1",
    );
    expect(res.status).toBe(200);
    expect(listArchiveFilesMissingSearchText).not.toHaveBeenCalled();
    const body = (await res.json()) as {
      results: ArchiveSearchHit[];
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
    };
    expect(body.total).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.has_more).toBe(false);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.file.id).toBe("af-2");
    expect(searchArchiveFiles).toHaveBeenCalledWith(
      "gateway",
      expect.objectContaining({
        match: "phrase",
        case_sensitive: true,
        origin: "upload",
        media_type: "markdown",
        unlinked_only: true,
      }),
    );

    const badRegex = await app.request("/api/v1/archives/search?q=%5Bbad&match=regex");
    expect(badRegex.status).toBe(400);
  });
});

describe("Postgres SQL contracts (chunksRepo & archivesRepo)", () => {
  function makeMockPool(rows: unknown[][]) {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sqlOrCfg: string | { text: string; values?: unknown[] }, args: unknown[] = []) => {
        if (typeof sqlOrCfg === "string") {
          calls.push({ sql: sqlOrCfg, args });
        } else {
          calls.push({ sql: sqlOrCfg.text, args: sqlOrCfg.values ?? [] });
        }
        return { rows, rowCount: rows.length };
      }),
    } as unknown as Pool;
    return { pool, calls };
  }

  it("chunksRepo generates per-doc ROW_NUMBER dedup, wiki/<subpath> & tags filters, and phrase/regex matched_lines", async () => {
    const sampleRow = [
      "doc-1",
      "alpha\nretry = 3\nomega",
      1,
      "Heading",
      0,
      "retry.md",
      "Retry",
      "/wiki/infra/net/",
      "md",
      1.5,
      "concept",
      "high",
      "",
      "",
      "",
      "",
      "",
      "[]",
      "wiki/infra/net/retry.md",
      '["net","ops"]',
      "2026-11-28 10:00:00",
    ];
    const { pool, calls } = makeMockPool([sampleRow]);
    const repo = chunksRepo(pool);

    const fuzzy = await repo.searchChunks("retry", 10, "wiki/infra/net", {
      tags: ["net"],
      tag_mode: "all",
    });
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0]?.relative_path).toBe("wiki/infra/net/retry.md");
    expect(fuzzy[0]?.tags).toEqual(["net", "ops"]);

    const ftsCall = calls[0]!;
    expect(ftsCall.sql).toContain("ROW_NUMBER() OVER");
    expect(ftsCall.sql).toContain("PARTITION BY d.id");
    expect(ftsCall.sql).toContain("d.relative_path = $");
    expect(ftsCall.sql).toContain("jsonb_array_elements_text");

    const metaCall = calls[1]!;
    expect(metaCall.sql).toContain("COALESCE(d.tags, '[]')");

    const regexHits = await repo.searchChunks("retry = \\d+", 5, "wiki", {
      match: "regex",
      case_sensitive: true,
    });
    expect(regexHits[0]?.match_type).toBe("regex");
    expect(regexHits[0]?.matched_lines).toEqual([{ line: 2, text: "retry = 3" }]);
    const regexCall = calls[calls.length - 1]!;
    expect(regexCall.sql).toContain("d.content ~ $1");
  });

  it("archivesRepo tokenizes Chinese queries, matches title & unlinked_only, and returns matched_lines on phrase", async () => {
    const archiveRow = [
      "af-1",
      "docs",
      "arch.md",
      "网关限流规范",
      "docs/arch.md",
      "text/markdown",
      "markdown",
      100,
      "sha1",
      "db",
      "",
      "upload",
      "",
      "",
      "2026-11-28 00:00:00",
      "2026-11-28 00:00:00",
      "第一行\n网关限流规范正文\n第三行",
      2.5,
      3,
    ];
    const { pool, calls } = makeMockPool([archiveRow]);
    const repo = archivesRepo(pool);

    const hits = await repo.searchArchiveFiles("网关限流", { unlinked_only: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.file.title).toBe("网关限流规范");
    expect(hits[0]?.match_type).toBe("both");
    expect(calls[0]!.sql).toContain("NOT EXISTS (SELECT 1 FROM document_archive_sources");
    expect(calls[0]!.sql).toContain("COALESCE(title, '')");
    // Chinese tokenization expands bigrams
    expect(calls[0]!.args).toContain("%网关%");

    const phraseHits = await repo.searchArchiveFiles("网关限流规范", { match: "phrase" });
    expect(phraseHits[0]?.matched_lines).toEqual([{ line: 2, text: "网关限流规范正文" }]);
  });
});

describe("MCP search & archive_search completeness", () => {
  it("allows archive_search under readonly policy and executes archive_search + hybrid/scope search", async () => {
    const roPolicy = defaultToolPolicy(false);
    expect(toolPolicyAllows(roPolicy, "archive_search")).toBe(true);
    expect(toolPolicyAllows(roPolicy, "search")).toBe(true);

    const server = new McpServer("test", "test");
    const tools = new Map<string, (args: Record<string, unknown>) => Promise<string>>();
    const origRegister = server.registerTool.bind(server);
    server.registerTool = (tool, handler) => {
      tools.set(tool.name, handler);
      origRegister(tool, handler);
    };

    const searchArchiveFiles = vi.fn(async () => [
      {
        file: makeArchiveFile(),
        match_type: "title" as const,
        snippet: "Gateway Spec snippet",
        score: 2.0,
        matched_lines: [{ line: 4, text: "Gateway rate limit" }],
      },
    ]);
    const db = {
      searchChunks: vi.fn(async () => [makeChunk()]),
      searchVector: vi.fn(async () => []),
      getConfig: vi.fn(async () => ""),
      listProviderInstances: vi.fn(async () => []),
      searchArchiveFiles,
    } as unknown as Store;

    registerTools(server, "/tmp", db);

    const archiveSearch = tools.get("archive_search");
    expect(archiveSearch).toBeDefined();
    const archOut = await archiveSearch!({ query: "gateway", unlinked_only: true });
    expect(archOut).toContain("specs/v1/gateway.md");
    expect(archOut).toContain("L4: Gateway rate limit");

    const mcpOut = await executeLocalSearch("/tmp", db, {
      mode: "search",
      query: "retry",
      path: "wiki/engineering/resilience",
      tags: ["resilience"],
      scope: "all",
    });
    expect(mcpOut).toContain("effective_mode: keyword; degraded:");
    expect(mcpOut).toContain("Archive Results (1)");
  });
});
