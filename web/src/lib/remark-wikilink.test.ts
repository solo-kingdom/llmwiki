import { describe, it, expect } from "vitest"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import { createRemarkWikiLink } from "@/lib/remark-wikilink"
import type { DocumentListItem } from "@/types"

function makeDocs(
  entries: Array<{ id: string; filename: string; path: string; title?: string }>,
): DocumentListItem[] {
  return entries.map((e) => ({
    id: e.id,
    filename: e.filename,
    title: e.title ?? e.filename,
    path: e.path,
    file_type: "md",
    page_count: 1,
    updated_at: "",
  }))
}

async function processMarkdown(
  md: string,
  documents: DocumentListItem[],
): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(createRemarkWikiLink(documents))
    .use(remarkStringify)
    .process(md)
  return String(result)
}

describe("remarkWikiLink", () => {
  const docs = makeDocs([
    { id: "doc-1", filename: "attention.md", path: "/wiki/concepts" },
    { id: "doc-2", filename: "transformer.md", path: "/wiki/concepts" },
    { id: "doc-3", filename: "overview.md", path: "/wiki" },
  ])

  it("converts basic [[wikilink]] to a clickable link", async () => {
    const result = await processMarkdown("See [[attention]] for details.", docs)
    expect(result).toContain("/d/doc-1")
    expect(result).toContain("attention")
  })

  it("converts [[target|display text]] with custom display text", async () => {
    const result = await processMarkdown(
      "Read about [[attention|注意力机制]].",
      docs,
    )
    expect(result).toContain("/d/doc-1")
    expect(result).toContain("注意力机制")
  })

  it("resolves wikilink by appending .md extension", async () => {
    const result = await processMarkdown("[[concepts/attention]]", docs)
    expect(result).toContain("/d/doc-1")
  })

  it("resolves wikilink by basename fallback", async () => {
    const result = await processMarkdown("[[overview]]", docs)
    expect(result).toContain("/d/doc-3")
  })

  it("resolves wikilink case-insensitively", async () => {
    const result = await processMarkdown("[[Attention]]", docs)
    expect(result).toContain("/d/doc-1")
  })

  it("marks unresolvable wikilink as broken", async () => {
    const result = await processMarkdown("[[nonexistent]]", docs)
    expect(result).toContain("wikilink-broken")
    expect(result).toContain("nonexistent")
    expect(result).not.toContain("/d/")
  })

  it("handles multiple wikilinks in one line", async () => {
    const result = await processMarkdown(
      "See [[attention]] and [[transformer]].",
      docs,
    )
    expect(result).toContain("/d/doc-1")
    expect(result).toContain("/d/doc-2")
  })

  it("does not match [[...]] inside code blocks", async () => {
    const result = await processMarkdown(
      "```\n[[not-a-link]]\n```\n\n[[attention]]",
      docs,
    )
    // The code block content should remain as-is
    expect(result).toContain("[[not-a-link]]")
    // But the outside wikilink should be converted
    expect(result).toContain("/d/doc-1")
  })

  it("handles empty document list by marking all links as broken", async () => {
    const result = await processMarkdown("[[attention]]", [])
    expect(result).toContain("wikilink-broken")
    expect(result).not.toContain("/d/")
  })

  it("preserves surrounding text around wikilinks", async () => {
    const result = await processMarkdown(
      "Before [[attention]] after.",
      docs,
    )
    expect(result).toContain("Before")
    expect(result).toContain("after")
    expect(result).toContain("/d/doc-1")
  })

  it("resolves wikilink with spaces via slug normalization", async () => {
    const slugDocs = makeDocs([
      { id: "doc-adam", filename: "adam-foroughi.md", path: "/wiki/entities" },
    ])
    const result = await processMarkdown(
      "Founded by [[Adam Foroughi]].",
      slugDocs,
    )
    expect(result).toContain("/d/doc-adam")
    expect(result).toContain("Adam Foroughi")
    expect(result).not.toContain("wikilink-broken")
  })

  it("resolves wikilink via title index fallback", async () => {
    const titleDocs = makeDocs([
      { id: "doc-1", filename: "special-char.md", path: "/wiki/entities", title: "Special Character" },
    ])
    const result = await processMarkdown(
      "See [[Special Character]] for details.",
      titleDocs,
    )
    expect(result).toContain("/d/doc-1")
    expect(result).not.toContain("wikilink-broken")
  })

  it("resolves wikilink with multiple consecutive spaces via slug normalization", async () => {
    const slugDocs = makeDocs([
      { id: "doc-long", filename: "some-long-name.md", path: "/wiki/entities" },
    ])
    const result = await processMarkdown(
      "See [[Some  Long   Name]] here.",
      slugDocs,
    )
    expect(result).toContain("/d/doc-long")
    expect(result).not.toContain("wikilink-broken")
  })
})
