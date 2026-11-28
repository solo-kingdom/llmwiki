import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveDocument,
  createFolder,
  createTextIngestJob,
  listIngestJobs,
  deleteFolder,
  getDocument,
  getWikiTree,
  listDocuments,
  listHistory,
  moveDocument,
  moveFolder,
  reopenDocument,
  searchArchiveFiles,
  searchDocuments,
} from "./api";

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? "OK" : "Bad Request",
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("builds document list filters as query params", async () => {
    const fetchMock = mockFetch([]);
    await listDocuments({ source_kind: "wiki", types: ["entity", "concept"], exclude_hidden: true });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/v1/documents?source_kind=wiki&types=entity&types=concept&exclude_hidden=true");
  });

  it("encodes document ids", async () => {
    const fetchMock = mockFetch({ id: "a/b" });
    await getDocument("a/b");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/v1/documents/a%2Fb");
  });

  it("sends search mode and types", async () => {
    const fetchMock = mockFetch({ query: "x", mode: "hybrid", results: [] });
    await searchDocuments("x", 5, ["entity"], "keyword");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/v1/search?q=x&limit=5&types=entity&mode=keyword");
  });

  it("posts text ingestion as JSON", async () => {
    const fetchMock = mockFetch({ job: { id: "job-1" } });
    await createTextIngestJob({ content: "hello", title: "T" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/ingest/jobs/text");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ content: "hello", title: "T" }));
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("builds ingest job list filters as query params", async () => {
    const fetchMock = mockFetch({
      jobs: [],
      total: 0,
      counts: { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
    });
    await listIngestJobs({ status: "failed", inputType: "text", q: "a b", limit: 50, offset: 50 });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/v1/ingest/jobs?limit=50&offset=50&status=failed&input_type=text&q=a+b");
  });

  it("surfaces server error messages", async () => {
    mockFetch({ error: "document not found" }, false, 404);
    await expect(getDocument("missing")).rejects.toThrow("document not found");
  });

  it("calls tree, folder CRUD, and document move endpoints", async () => {
    const fetchMock = mockFetch({ folders: [], documents: [] });
    await getWikiTree({ exclude_hidden: true, types: ["concept"] });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/v1/tree?types=concept");

    await createFolder({ path: "AI工程/Agent", display_name: "Agent" });
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe("/api/v1/folders");

    await moveFolder({ from_path: "a", to_path: "b" });
    expect((fetchMock.mock.calls[2] as unknown as [string])[0]).toBe("/api/v1/folders/move");

    await deleteFolder({ path: "a", mode: "empty" });
    expect((fetchMock.mock.calls[3] as unknown as [string])[0]).toBe("/api/v1/folders?path=a&mode=empty");

    await moveDocument("doc-1", { target_folder: "b" });
    expect((fetchMock.mock.calls[4] as unknown as [string])[0]).toBe("/api/v1/documents/doc-1/move");
  });

  it("calls archive, reopen, and archived filter params", async () => {
    const fetchMock = mockFetch({ id: "doc-1" });
    await getWikiTree({ archived: "include", review_overdue: true });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "/api/v1/tree?archived=include&review_overdue=true",
    );

    await searchDocuments("panic", 5, ["experience"], "hybrid", {
      archived: "only",
      kinds: ["pitfall"],
    });
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(
      "/api/v1/search?q=panic&limit=5&types=experience&mode=hybrid&archived=only&kinds=pitfall",
    );

    await archiveDocument("doc-1", { reason: "已由新方案替代" });
    expect((fetchMock.mock.calls[2] as unknown as [string])[0]).toBe("/api/v1/documents/doc-1/archive");

    await reopenDocument("doc-1", { reason: "重新启用" });
    expect((fetchMock.mock.calls[3] as unknown as [string])[0]).toBe("/api/v1/documents/doc-1/reopen");
  });

  it("calls archive search endpoint with query, kind, and limit", async () => {
    const fetchMock = mockFetch({ query: "rag", results: [] });
    await searchArchiveFiles({ q: "rag", kind: "markdown", limit: 15 });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/v1/archives/search?q=rag&kind=markdown&limit=15");
  });

  it("builds timeline history filters and paging as query params", async () => {
    const fetchMock = mockFetch({
      changes: [],
      total: 0,
      limit: 20,
      offset: 20,
      has_more: false,
      counts: { ingest: 0, review_apply: 0, rollback: 0, manual: 0, delete: 0, import: 0 },
    });
    await listHistory({
      limit: 20,
      offset: 20,
      kind: "ingest",
      from: "2026-11-27T16:00:00.000Z",
      to: "2026-11-28T15:59:59.000Z",
      q: "wiki/ai",
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      "/api/v1/history?limit=20&offset=20&kind=ingest&from=2026-11-27T16%3A00%3A00.000Z&to=2026-11-28T15%3A59%3A59.000Z&q=wiki%2Fai",
    );
  });
});
