import { describe, expect, it, vi } from "vitest";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { cleanupLegacySystemPages, isLegacySystemPagePath } from "./cleanup_legacy.js";

describe("cleanupLegacySystemPages", () => {
  it("identifies legacy log.md, index.md, and templates/* while preserving overview.md and business pages", async () => {
    expect(isLegacySystemPagePath("wiki/log.md")).toBe(true);
    expect(isLegacySystemPagePath("wiki/index.md")).toBe(true);
    expect(isLegacySystemPagePath("wiki/templates/entity.md")).toBe(true);
    expect(isLegacySystemPagePath("wiki/overview.md")).toBe(false);
    expect(isLegacySystemPagePath("wiki/products/llmwiki/_overview.md")).toBe(false);

    const docs = [
      { id: "1", relative_path: "wiki/log.md", title: "操作日志" },
      { id: "2", relative_path: "wiki/index.md", title: "内容目录" },
      { id: "3", relative_path: "wiki/templates/entity.md", title: "示例实体" },
      { id: "4", relative_path: "wiki/overview.md", title: "全局总览" },
      { id: "5", relative_path: "wiki/products/llmwiki/note.md", title: "Note" },
    ] as Document[];

    const applyChangeSet = vi.fn().mockResolvedValue(undefined);
    const store = {
      listDocumentsFiltered: vi.fn().mockResolvedValue(docs),
      applyChangeSet,
    } as unknown as Store;

    const dry = await cleanupLegacySystemPages(store, false);
    expect(dry.dryRun).toBe(true);
    expect(dry.candidates.map((c) => c.relative_path)).toEqual([
      "wiki/log.md",
      "wiki/index.md",
      "wiki/templates/entity.md",
    ]);
    expect(dry.deletedCount).toBe(0);
    expect(applyChangeSet).not.toHaveBeenCalled();

    const applied = await cleanupLegacySystemPages(store, true);
    expect(applied.dryRun).toBe(false);
    expect(applied.deletedCount).toBe(3);
    expect(applyChangeSet).toHaveBeenCalledTimes(1);
    const [cs, writes] = applyChangeSet.mock.calls[0]!;
    expect(cs.kind).toBe("delete");
    expect(writes).toHaveLength(3);
  });
});
