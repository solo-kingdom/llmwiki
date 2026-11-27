import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../llm/client.js";
import type { Store } from "../store/interfaces.js";
import type { StreamEvent } from "../llm/types.js";
import { Pipeline } from "./pipeline.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "llmwiki-pipeline-plan-"));
  tempDirs.push(dir);
  return dir;
}

const source = {
  kind: "text" as const,
  canonicalPath: "source.md",
  originalName: "source.md",
  sourceRef: "",
  content: new TextEncoder().encode("Provider 协议错配返回 401。"),
};

function client(analysis: string, generated: string, onGenerate?: () => void): Client {
  return {
    model: "fake",
    onRetry: null,
    chat: async () => ({ content: "", reasoningContent: "", toolCalls: [] }),
    streamChat: async function* (messages: Array<{ role: string; content?: string }>): AsyncGenerator<StreamEvent> {
      const user = messages.find((message) => message.role === "user")?.content ?? "";
      const generation = user.includes("请按 FILE 块格式生成 wiki 页面");
      if (generation) onGenerate?.();
      yield { type: "token", content: generation ? generated : analysis };
      yield { type: "done" };
    },
  } as unknown as Client;
}

const pagePath = "wiki/产品与项目/llmwiki/Provider协议错配导致401.md";
const plan = JSON.stringify({
  pages: [{
    path: pagePath,
    action: "create",
    type: "experience",
    title: "Provider协议错配导致401",
    reuse_reason: "相同症状可复用",
  }],
});
const file = `---FILE: ${pagePath}\n---\ntitle: Provider协议错配导致401\ntype: experience\n---\n# Provider协议错配导致401\n\n## 经验结论\n检查协议。\n---END FILE---\n`;

describe("Pipeline page plan gate", () => {
  it("does not call generation or write files when analysis is empty", async () => {
    let generated = false;
    const pipeline = new Pipeline(await workspace(), null, client("", file, () => { generated = true; }));
    pipeline.setToolLoopConfig({ maxRounds: 0, maxToolCallsPerRound: 0 });

    await expect(pipeline.ingestNormalized(source)).rejects.toThrow("analysis is empty");
    expect(generated).toBe(false);
  });

  it("generates only from a valid analysis page plan", async () => {
    const pipeline = new Pipeline(await workspace(), null, client(plan, file));
    pipeline.setToolLoopConfig({ maxRounds: 0, maxToolCallsPerRound: 0 });

    await expect(pipeline.ingestNormalized(source)).resolves.toEqual([pagePath]);
  });

  it("rejects a new legacy page before applyChangeSet in enforce mode", async () => {
    const legacyPath = "wiki/concepts/Provider协议错配导致401.md";
    const legacyPlan = JSON.stringify({
      pages: [{
        path: legacyPath,
        action: "create",
        type: "experience",
        title: "Provider协议错配导致401",
        reuse_reason: "相同症状可复用",
      }],
    });
    const legacyFile = file.replaceAll(pagePath, legacyPath);
    const applyChangeSet = vi.fn();
    const db = {
      getConfig: async (key: string) => key === "structure_policy_mode" ? "enforce" : "",
      listFolders: async () => [],
      listDocumentsFiltered: async () => [],
      getDocumentByRelativePath: async () => null,
      applyChangeSet,
    } as unknown as Store;
    const pipeline = new Pipeline(await workspace(), db, client(legacyPlan, legacyFile));
    pipeline.setChangeSetMeta("ingest", "job-enforce", "", "source.md", "source");
    pipeline.setToolLoopConfig({ maxRounds: 0, maxToolCallsPerRound: 0 });

    await expect(pipeline.ingestNormalized(source)).rejects.toThrow("legacy 类型根");
    expect(applyChangeSet).not.toHaveBeenCalled();
  });
});
