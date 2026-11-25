import { describe, expect, it } from "vitest";
import {
  ancestorFolderPaths,
  classifyWikiPath,
  folderPathFromWikiRelPath,
  normalizeFolderPath,
  resolvePageType,
  validateFolderPath,
  validateWikiWritePath,
} from "./wiki_org.js";

describe("wiki_org tree paths", () => {
  it("normalizes and validates nested topic folder paths", () => {
    expect(normalizeFolderPath("/wiki/AI工程/Agent/")).toBe("AI工程/Agent");
    expect(validateFolderPath("AI工程/Agent/Memory")).toBe("AI工程/Agent/Memory");
    expect(ancestorFolderPaths("a/b/c")).toEqual(["a", "a/b", "a/b/c"]);
    expect(folderPathFromWikiRelPath("wiki/a/b/c/page.md")).toBe("a/b/c");
    expect(folderPathFromWikiRelPath("wiki/overview.md")).toBe("");
  });

  it("rejects unsafe or reserved folder paths", () => {
    expect(() => validateFolderPath("")).toThrow();
    expect(() => validateFolderPath("../etc")).toThrow();
    expect(() => validateFolderPath("a/.hidden")).toThrow();
    expect(() => validateFolderPath("templates/custom")).toThrow();
    expect(() => validateFolderPath("sources/sub")).toThrow();
    expect(() => validateFolderPath("raw/sub")).toThrow();
    expect(() => validateFolderPath("1/2/3/4/5/6/7/8/9")).toThrow();
  });

  it("classifies and validates arbitrary nested wiki pages", () => {
    expect(classifyWikiPath("wiki/AI工程/Agent/harness.md")).toBe("typed_content");
    expect(classifyWikiPath("wiki/concepts/legacy.md")).toBe("typed_content");
    expect(classifyWikiPath("wiki/overview.md")).toBe("reserved_top_level");
    expect(classifyWikiPath("wiki/templates/concept.md")).toBe("system");
    expect(classifyWikiPath("wiki/top-level.md")).toBe("misplaced");

    expect(() => validateWikiWritePath("wiki/AI工程/Agent/harness.md")).not.toThrow();
    expect(() => validateWikiWritePath("wiki/top-level.md")).toThrow();
    expect(() => validateWikiWritePath("wiki/templates/concept.md")).toThrow();
  });

  it("resolves page_type from frontmatter, explicit type, or legacy directory", () => {
    expect(resolvePageType("concept", "", "wiki/AI工程/harness.md")).toBe("concept");
    expect(resolvePageType("experience", "", "wiki/AI工程/pitfall.md")).toBe("experience");
    expect(resolvePageType("", "ledger", "wiki/Ops/accounts.md")).toBe("ledger");
    expect(resolvePageType("", "entity", "wiki/AI工程/openai.md")).toBe("entity");
    expect(resolvePageType("", "", "wiki/concepts/legacy.md")).toBe("concept");
    expect(resolvePageType("", "", "wiki/experiences/exp.md")).toBe("experience");
    expect(resolvePageType("", "", "wiki/ledgers/l1.md")).toBe("ledger");
    expect(resolvePageType("", "", "wiki/sources/src.md")).toBe("source");
    expect(resolvePageType("", "", "wiki/AI工程/note.md")).toBe("page");
  });
});
