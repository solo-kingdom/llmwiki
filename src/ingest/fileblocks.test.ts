import { describe, expect, it } from "vitest";
import { normalizeWikiFilePath } from "./fileblocks.js";

describe("fileblocks", () => {
  it("normalizes nested topic paths and legacy shorthand prefixes", () => {
    expect(normalizeWikiFilePath("wiki/AI工程/Agent/harness.md")).toBe("wiki/AI工程/Agent/harness.md");
    expect(normalizeWikiFilePath("AI工程/Agent/harness.md")).toBe("wiki/AI工程/Agent/harness.md");
    expect(normalizeWikiFilePath("concepts/attention.md")).toBe("wiki/concepts/attention.md");
    expect(normalizeWikiFilePath("entity/openai.md")).toBe("wiki/entities/openai.md");
    expect(() => normalizeWikiFilePath("top-level.md")).toThrow();
  });
});
