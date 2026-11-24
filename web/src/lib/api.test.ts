import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFolder,
  createTextIngestJob,
  deleteFolder,
  getDocument,
  getWikiTree,
  listDocuments,
  moveDocument,
  moveFolder,
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
});
