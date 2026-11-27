import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "../llm/client.js";
import type { StreamEvent } from "../llm/types.js";
import type { Store } from "../store/interfaces.js";
import type { ChangeSet, Document, PageWrite } from "../store/types.js";
import { IngestCache } from "./cache.js";
import { PageLockManager, withPageLocks } from "./lock.js";
import { Pipeline } from "./pipeline.js";

const PAGE = "wiki/concepts/共享页.md";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-lock-"));
  tempDirs.push(dir);
  return dir;
}

/** In-memory store with the same read-then-commit shape as the PostgreSQL one. */
function fakeStore(docs: Map<string, Document>, changeSets: ChangeSet[], readDelayMs = 0): Store {
  return {
    getConfig: async () => "",
    getDocumentByRelativePath: async (relativePath: string) => {
      if (readDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, readDelayMs));
      return docs.get(relativePath) ?? null;
    },
    applyChangeSet: async (changeSet: ChangeSet, writes: PageWrite[]) => {
      changeSets.push({ ...changeSet, id: randomUUID() });
      for (const write of writes) {
        if (!write.document) continue;
        write.document.id ||= randomUUID();
        docs.set(write.document.relative_path, { ...write.document });
      }
    },
    listDocumentsFiltered: async () => [...docs.values()],
    listReferenceEntries: async () => [],
    replaceReferenceEntriesInTx: async () => undefined,
    replaceReferencesInTx: async () => undefined,
    listFolders: async () => [],
  } as unknown as Store;
}

/**
 * A model that answers the three prompts the ingest pipeline issues: analysis, generation
 * (one wiki page carrying the job's tag) and the whole-body merge (old body + new body).
 */
function fakeClient(
  tag: string,
  hooks: { beforeGenerationEnds?: () => Promise<void> } = {},
): Client {
  const analysis = JSON.stringify({
    pages: [{
      path: PAGE,
      action: "create",
      type: "concept",
      title: "共享页",
      reuse_reason: "并发测试共享同一概念页",
    }],
  });
  const page = `---FILE: ${PAGE}
---
title: 共享页
type: concept
---
## 来自 ${tag}
${tag} 写入的内容
---END FILE---
`;
  async function* streamChat(messages: Array<{ role: string; content?: string }>): AsyncGenerator<StreamEvent> {
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    let answer = analysis;
    if (user.includes("请按 FILE 块格式生成 wiki 页面")) {
      await hooks.beforeGenerationEnds?.();
      answer = page;
    } else if (user.includes("合并以下 wiki 页面正文")) {
      const match = /## 旧正文\n\n([\s\S]*?)\n\n## 新正文\n\n([\s\S]*)$/.exec(user);
      const oldBody = match?.[1]?.trim() ?? "";
      const newBody = match?.[2]?.trim() ?? "";
      answer = [oldBody, newBody].filter(Boolean).join("\n\n");
    }
    yield { type: "token", content: answer };
    yield { type: "done" };
  }
  return {
    model: "fake",
    onRetry: null,
    chat: async () => ({ content: "", reasoningContent: "", toolCalls: [] }),
    streamChat,
  } as unknown as Client;
}

async function runJob(
  workspace: string,
  store: Store,
  lockManager: PageLockManager,
  tag: string,
  beforeGenerationEnds: () => Promise<void>,
): Promise<void> {
  const pipeline = new Pipeline(workspace, store, fakeClient(tag, { beforeGenerationEnds }), lockManager);
  pipeline.setToolLoopConfig({ maxRounds: 0, maxToolCallsPerRound: 0 });
  pipeline.setChangeSetMeta("ingest", `job-${tag}`, "", `${tag}.md`, "");
  await pipeline.ingestNormalized({
    kind: "text",
    canonicalPath: `${tag}.md`,
    sourceRef: "",
    content: new TextEncoder().encode(`源内容 ${tag}`),
  });
}

/** Releases both jobs from generation at once, so they race for the page on equal footing. */
function startGate(): () => Promise<void> {
  let arrivals = 0;
  let open: (() => void) | null = null;
  return async () => {
    arrivals += 1;
    if (arrivals >= 2) open?.();
    else await new Promise<void>((resolve) => {
      open = resolve;
    });
  };
}

describe("ingest page locks", () => {
  it("keeps both contributions when two jobs write the same page under a shared lock", async () => {
    const workspace = await tempWorkspace();
    const docs = new Map<string, Document>();
    const changeSets: ChangeSet[] = [];
    const store = fakeStore(docs, changeSets, 5);
    const gate = startGate();
    const shared = new PageLockManager();

    await Promise.all([
      runJob(workspace, store, shared, "A", gate),
      runJob(workspace, store, shared, "B", gate),
    ]);

    const content = docs.get(PAGE)?.content ?? "";
    expect(content).toContain("来自 A");
    expect(content).toContain("来自 B");
    expect(changeSets).toHaveLength(2);
  });

  it("reproduces the lost update when jobs do not share the lock manager", async () => {
    const workspace = await tempWorkspace();
    const docs = new Map<string, Document>();
    const changeSets: ChangeSet[] = [];
    const store = fakeStore(docs, changeSets, 5);
    const gate = startGate();

    await Promise.all([
      runJob(workspace, store, new PageLockManager(), "A", gate),
      runJob(workspace, store, new PageLockManager(), "B", gate),
    ]);

    const content = docs.get(PAGE)?.content ?? "";
    expect(content.includes("来自 A") && content.includes("来自 B")).toBe(false);
    expect(changeSets).toHaveLength(2);
  });
});

describe("PageLockManager.lockAll", () => {
  it("lets jobs holding overlapping pages in opposite order finish without deadlock", async () => {
    const manager = new PageLockManager();
    const active = new Map<string, number>();
    const overlaps: string[] = [];
    const enter = (pages: string[]) => {
      for (const page of pages) {
        const count = active.get(page) ?? 0;
        if (count > 0) overlaps.push(page);
        active.set(page, count + 1);
      }
    };
    const leave = (pages: string[]) => {
      for (const page of pages) active.set(page, (active.get(page) ?? 1) - 1);
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
    const first = ["a.md", "b.md", "c.md"];
    const second = ["c.md", "b.md", "x.md"];

    await Promise.all([
      withPageLocks(manager, first, async () => {
        enter(first);
        await pause();
        leave(first);
      }),
      withPageLocks(manager, second, async () => {
        enter(second);
        await pause();
        leave(second);
      }),
      withPageLocks(manager, ["b.md", "a.md"], async () => {
        enter(["b.md", "a.md"]);
        leave(["b.md", "a.md"]);
      }),
    ]);

    expect(overlaps).toEqual([]);
    expect(manager.activeLocks()).toEqual([]);
  });

  it("releases on failure and tolerates duplicate paths", async () => {
    const manager = new PageLockManager();
    await expect(
      withPageLocks(manager, ["a.md", "A.md", "/a.md/"], async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(manager.activeLocks()).toEqual([]);
  });
});

describe("IngestCache under concurrency", () => {
  it("keeps every entry when many jobs save at once", async () => {
    const workspace = await tempWorkspace();
    const cache = new IngestCache(workspace);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        cache.save(`key-${index}`, { source_name: `s${index}`, sha256: "x", written_files: [] }),
      ),
    );

    const stored = JSON.parse(await readFile(cache.cachePath(), "utf8")) as { entries: Record<string, unknown> };
    expect(Object.keys(stored.entries)).toHaveLength(20);
  });

  it("treats an unreadable cache file as empty instead of failing the job", async () => {
    const workspace = await tempWorkspace();
    const cache = new IngestCache(workspace);
    await mkdir(path.dirname(cache.cachePath()), { recursive: true });
    await writeFile(cache.cachePath(), '{"entries": {"a": ', "utf8");

    expect(await cache.load()).toEqual({ entries: {} });
  });
});
