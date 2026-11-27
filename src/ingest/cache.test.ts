import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { IngestCache, cacheKeyForNormalized, contentSHA256 } from "./cache.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("IngestCache", () => {
  it("validates cached outputs against DB-SSOT and rulesHash", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-cache-"));
    tempDirs.push(dir);
    let docExists = true;
    const db = {
      getDocumentByRelativePath: async (rel: string) =>
        docExists && rel === "wiki/products/llmwiki/note.md"
          ? ({ id: "doc-1", relative_path: rel } as Document)
          : null,
    } as unknown as Store;

    const source = {
      kind: "text" as const,
      canonicalPath: "source.md",
      originalName: "source.md",
      sourceRef: "",
      content: new TextEncoder().encode("cache test body"),
    };
    const cache = new IngestCache(dir, db);
    await cache.saveForSource(source, ["wiki/products/llmwiki/note.md"], "rules-v1");

    expect(await cache.lookupForSource(source, [], "rules-v1")).not.toBeNull();
    expect(await cache.lookupForSource(source, [], "rules-v2")).toBeNull();

    docExists = false;
    expect(await cache.lookupForSource(source, [], "rules-v1")).toBeNull();
  });
});
