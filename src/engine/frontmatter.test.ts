import { describe, expect, it } from "vitest";
import {
  getMetadataJSON,
  getTagsString,
  parseFrontmatter,
  titleFromFilename,
} from "./frontmatter.js";

describe("frontmatter", () => {
  it("parses YAML frontmatter", () => {
    const fm = parseFrontmatter(
      "---\ntitle: Attention\ntype: concept\ndate: 2026-01-02\ntags:\n  - ml\n  - nlp\ndescription: notes\n---\n\nBody",
    );
    expect(fm.title).toBe("Attention");
    expect(fm.type).toBe("concept");
    expect(fm.date).toBe("2026-01-02");
    expect(fm.tags).toEqual(["ml", "nlp"]);
    expect(fm.description).toBe("notes");
  });

  it("returns empty metadata when frontmatter is absent", () => {
    expect(parseFrontmatter("# Just a heading")).toEqual({
      title: "",
      description: "",
      date: "",
      type: "",
      tags: [],
    });
  });

  it("returns empty metadata for invalid YAML", () => {
    const fm = parseFrontmatter("---\n: : :\n---\nBody");
    expect(fm.title).toBe("");
    expect(fm.tags).toEqual([]);
  });

  it("serializes tags and description", () => {
    const fm = { title: "T", description: "D", date: "", type: "", tags: ["a", "b"] };
    expect(getTagsString(fm)).toBe('["a","b"]');
    expect(getMetadataJSON(fm)).toBe('{"description":"D"}');
    expect(getMetadataJSON({ ...fm, description: "" })).toBe("{}");
  });

  it("derives titles from filenames", () => {
    expect(titleFromFilename("attention-is-all-you-need.md")).toBe("Attention Is All You Need");
    expect(titleFromFilename("wiki_org.md")).toBe("Wiki Org");
    expect(titleFromFilename("README")).toBe("README");
  });
});
