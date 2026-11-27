import { describe, expect, it } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import type { CacheEntry } from "./types.js";
import { IngestCache } from "./cache.js";

describe("IngestCache", () => {
  it("validates cached outputs against DB-SSOT and rulesHash without workspace disk files", async () => {
    let docExists = true;
    const rows = new Map<string, CacheEntry>();
    const db = {
      getDocumentByRelativePath: async (rel: string) =>
        docExists && rel === "wiki/products/llmwiki/note.md"
          ? ({ id: "doc-1", relative_path: rel } as Document)
          : null,
      getIngestCacheEntry: async (key: string) => rows.get(key) ?? null,
      upsertIngestCacheEntry: async (key: string, entry: CacheEntry) => {
        rows.set(key, entry);
      },
    } as unknown as Store;

    const source = {
      kind: "text" as const,
      canonicalPath: "source.md",
      originalName: "source.md",
      sourceRef: "",
      content: new TextEncoder().encode("cache test body"),
    };
    const cache = new IngestCache("", db);
    await cache.saveForSource(source, ["wiki/products/llmwiki/note.md"], "rules-v1");

    expect(await cache.lookupForSource(source, [], "rules-v1")).not.toBeNull();
    expect(await cache.lookupForSource(source, [], "rules-v2")).toBeNull();

    docExists = false;
    expect(await cache.lookupForSource(source, [], "rules-v1")).toBeNull();
  });
});
