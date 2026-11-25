import { describe, expect, it } from "vitest";
import { IndexBuilder, indexEntriesFromDocuments } from "./index_builder.js";

describe("indexEntriesFromDocuments", () => {
  it("builds entries from wiki documents and skips system/template pages", () => {
    const entries = indexEntriesFromDocuments([
      {
        relative_path: "wiki/concepts/RTA 接口.md",
        title: "RTA 接口",
        date: "2026-05-30",
        content: "---\ntitle: RTA 接口\ndescription: 实时决策接口\n---\n",
        source_kind: "wiki",
      },
      {
        relative_path: "wiki/index.md",
        title: "内容目录",
        date: "2026-11-25",
        content: "",
        source_kind: "wiki",
      },
      {
        relative_path: "wiki/templates/concept.md",
        title: "示例概念",
        date: "2026-05-24",
        content: "",
        source_kind: "wiki",
      },
    ]);

    expect([...entries.keys()]).toEqual(["concepts"]);
    expect(entries.get("concepts")?.[0]).toMatchObject({
      subdir: "concepts",
      slug: "RTA 接口",
      title: "RTA 接口",
      description: "实时决策接口",
      date: "2026-05-30",
    });
  });

  it("emits GFM-safe links with escaped pipes", () => {
    const entries = indexEntriesFromDocuments([
      {
        relative_path: "wiki/concepts/RTA 接口.md",
        title: "RTA 接口",
        date: "2026-05-30",
        content: "",
        source_kind: "wiki",
      },
    ]);
    const content = new IndexBuilder("").buildIndexContent("2026-11-25", entries);
    expect(content).toContain("[[concepts/RTA 接口\\|RTA 接口]]");
  });
});
