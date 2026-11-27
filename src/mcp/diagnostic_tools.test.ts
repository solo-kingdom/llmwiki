import { describe, expect, it, vi } from "vitest";
import { executeLocalStructure, formatFolderTreeForPrompt } from "./diagnostic_tools.js";
import type { Store } from "../store/interfaces.js";

describe("diagnostic_tools structure", () => {
  it("renders nested folders, empty folders, and document page_type", async () => {
    const db = {
      listDocuments: vi.fn().mockResolvedValue([
        {
          id: "d1",
          filename: "harness.md",
          title: "Harness Engineering",
          path: "/wiki/AI工程/Agent/",
          relative_path: "wiki/AI工程/Agent/harness.md",
          source_kind: "wiki",
          page_type: "concept",
          tags: ["agent"],
        },
      ]),
      listFolders: vi.fn().mockResolvedValue([
        {
          path: "AI工程",
          display_name: "AI 工程",
          description: "工程方法",
          sort_order: 1,
          created_at: "",
          updated_at: "",
          direct_count: 0,
          total_count: 1,
        },
        {
          path: "AI工程/Agent",
          display_name: "Agent",
          description: "",
          sort_order: 0,
          created_at: "",
          updated_at: "",
          direct_count: 1,
          total_count: 1,
        },
        {
          path: "待整理",
          display_name: "",
          description: "",
          sort_order: 2,
          created_at: "",
          updated_at: "",
          direct_count: 0,
          total_count: 0,
        },
      ]),
    } as unknown as Store;

    const out = await executeLocalStructure("/tmp/ws", db);
    expect(out).toContain("AI工程/ (AI 工程)");
    expect(out).toContain("Agent/ (Agent)");
    expect(out).toContain("Harness Engineering [concept] [agent]");
    expect(out).toContain("(空目录)");

    const promptTree = formatFolderTreeForPrompt(await db.listFolders(true), await db.listDocuments());
    expect(promptTree).toContain("wiki/AI工程/");
    expect(promptTree).toContain("wiki/AI工程/Agent/");
  });

  it("marks legacy roots as update-only in report and enforce modes", () => {
    const folders = [{
      path: "concepts",
      display_name: "概念",
      description: "旧目录",
      sort_order: 0,
      created_at: "",
      updated_at: "",
      direct_count: 1,
      total_count: 1,
    }];
    const docs = [{
      source_kind: "wiki",
      relative_path: "wiki/concepts/legacy.md",
    }] as never[];
    const output = formatFolderTreeForPrompt(folders, docs, 80, "enforce");
    expect(output).toContain("legacy：仅用于存量更新");
  });
});
