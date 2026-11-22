import { describe, expect, it } from "vitest";
import { ReferenceParser } from "./references.js";

const parser = new ReferenceParser([
  {
    id: "transformer-id",
    filename: "transformer.md",
    title: "Transformer",
    path: "/wiki/concepts/",
  },
  {
    id: "attention-id",
    filename: "attention.md",
    title: "Attention",
    path: "/wiki/entities/",
  },
  {
    id: "paper-id",
    filename: "paper.pdf",
    title: "Paper",
    path: "/sources/",
  },
]);

describe("references", () => {
  it("parses double-bracket wiki links", () => {
    const refs = parser.parseReferences("See [[transformer]] for details.", "/wiki/entities/attention.md");
    expect(refs).toContainEqual({
      targetPath: "transformer-id",
      refType: "links_to",
      page: null,
    });
  });

  it("parses relative markdown links", () => {
    const refs = parser.parseReferences("[x](../concepts/transformer.md)", "/wiki/entities/attention.md");
    expect(refs.some((ref) => ref.targetPath === "transformer-id" && ref.refType === "links_to")).toBe(true);
  });

  it("skips external, anchor and image links", () => {
    const content = "[a](https://example.com) [b](#section) ![c](img.png)";
    expect(parser.parseReferences(content, "/wiki/entities/attention.md")).toEqual([]);
  });

  it("parses footnote citations with page numbers", () => {
    const refs = parser.parseReferences("Text.[^1]\n\n[^1]: paper.pdf, p.3", "/wiki/concepts/transformer.md");
    expect(refs).toContainEqual({
      targetPath: "paper-id",
      refType: "cites",
      page: 3,
    });
  });

  it("resolves by title when the path is not exact", () => {
    const refs = parser.parseReferences("[[Attention]]", "/wiki/concepts/transformer.md");
    expect(refs[0]?.targetPath).toBe("attention-id");
  });
});

describe("ReferenceParser.resolveLink space/underscore variants", () => {
  const docs = [
    { id: "d1", filename: "Adam_Foroughi.md", title: "Adam Foroughi", path: "/wiki/entities/" },
    { id: "d2", filename: "小团队_AI杠杆模型.md", title: "小团队 AI 杠杆模型", path: "/wiki/concepts/" },
  ];

  function resolve(target: string, docPath: string): string {
    const parser = new ReferenceParser(docs);
    return parser.resolveLink(target, docPath);
  }

  it("resolves [[Adam Foroughi]] against underscore filename", () => {
    expect(resolve("Adam Foroughi", "/wiki/entities/X.md")).toBe("d1");
    expect(resolve("entities/Adam Foroughi", "/wiki/entities/X.md")).toBe("d1");
  });

  it("resolves underscore targets against spaced titles", () => {
    expect(resolve("小团队_AI杠杆模型", "/wiki/entities/X.md")).toBe("d2");
  });

  it("resolves via spaced title directly", () => {
    expect(resolve("Adam Foroughi", "/wiki/concepts/Y.md")).toBe("d1");
  });
});
