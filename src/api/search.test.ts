import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import type { Store } from "../store/interfaces.js";
import type { SearchChunk } from "../store/types.js";
import { buildSearchSnippet } from "./search.js";

describe("buildSearchSnippet", () => {
  it("returns full normalized text when shorter than maxLen", () => {
    expect(buildSearchSnippet("  hello   world\n\nfoo  ", "world", 100)).toBe("hello world foo");
  });

  it("centers snippet around the first matched term with ellipses", () => {
    const prefix = "a".repeat(120);
    const suffix = "b".repeat(120);
    const content = `${prefix} targetKeyword appears here ${suffix}`;
    const snippet = buildSearchSnippet(content, "targetKeyword", 80);
    expect(snippet).toContain("targetKeyword");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(82);
  });

  it("falls back to leading window when query does not literally appear", () => {
    const content = "前导说明内容".repeat(40);
    const snippet = buildSearchSnippet(content, "unmatched", 60);
    expect(snippet.startsWith("前导说明内容")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(61);
  });
});

describe("GET /api/v1/search snippet", () => {
  it("attaches snippet to search results while preserving content", async () => {
    const longBody = `${"无关背景。".repeat(35)} 关键报错 ECONNREFUSED 发生在上游连接池耗尽时。${"后续细节。".repeat(35)}`;
    const chunk: SearchChunk = {
      document_id: "doc-1",
      content: longBody,
      page: 1,
      header_breadcrumb: "根因",
      chunk_index: 0,
      filename: "conn-pool.md",
      title: "连接池耗尽",
      path: "wiki/experience/conn-pool.md",
      file_type: "md",
      page_type: "experience",
      score: 0.92,
    };
    const searchChunks = vi.fn(async () => [chunk]);
    const app = createApp({
      db: { searchChunks } as unknown as Store,
      token: "",
      publicWiki: true,
      noMcp: true,
      mcpAllowWrite: false,
      workspace: "",
      webRoot: "/tmp/nonexistent-web",
      skillsRoot: path.resolve(process.cwd(), "skills"),
    });

    const res = await app.request("/api/v1/search?q=ECONNREFUSED&mode=keyword");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: SearchChunk[] };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.content).toBe(longBody);
    expect(body.results[0]?.snippet).toContain("ECONNREFUSED");
    expect((body.results[0]?.snippet ?? "").length).toBeLessThan(longBody.length);
  });
});
