import { describe, it, expect } from "vitest"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import { createRemarkWikiLink } from "@/lib/remark-wikilink"
import type { DocumentListItem } from "@/types"
import type { Root } from "mdast"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAstNode = Record<string, any>

interface LinkAstNode {
  type: string
  url?: string
  data?: {
    hProperties?: {
      className?: string
    }
  }
}

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

/** Process markdown and return the AST for direct inspection. */
async function processToAst(
  md: string,
  documents: DocumentListItem[],
): Promise<Root> {
  const processor = unified()
    .use(remarkParse)
    .use(createRemarkWikiLink(documents))
  const tree = processor.parse(md)
  const transformed = await processor.run(tree, md)
  return transformed as Root
}

/** Extract children from a paragraph AST node. */
function getParaChildren(ast: Root): AnyAstNode[] {
  const para = ast.children[0] as AnyAstNode | undefined
  return para?.children ?? []
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

  it("marks unresolvable wikilink as broken link node", async () => {
    const ast = await processToAst("[[nonexistent]]", docs)
    const children = getParaChildren(ast) as LinkAstNode[]
    const brokenLink = children.find(
      (c) => c.type === "link" && c.url === "#",
    )
    expect(brokenLink).toBeDefined()
    expect(brokenLink!.data?.hProperties?.className).toBe("wikilink-broken")
    // Verify no html nodes in the AST
    const hasHtmlNode = children.some((c) => c.type === "html")
    expect(hasHtmlNode).toBe(false)
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
    const ast = await processToAst("[[attention]]", [])
    const children = getParaChildren(ast) as LinkAstNode[]
    const brokenLink = children.find(
      (c) => c.type === "link" && c.url === "#",
    )
    expect(brokenLink).toBeDefined()
    expect(brokenLink!.data?.hProperties?.className).toBe("wikilink-broken")
  })

  it("broken wikilink output does not contain html node type", async () => {
    const ast = await processToAst("[[nonexistent]]", docs)
    const children = getParaChildren(ast)
    // No html node type — broken links use link nodes now
    expect(children.every((c) => c.type !== "html")).toBe(true)
    // Should contain a link node
    const link = children.find((c) => c.type === "link")
    expect(link).toBeDefined()
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

  it("parses GFM-escaped wikilink display separator", async () => {
    const entityDocs = makeDocs([
      {
        id: "doc-alpha",
        filename: "alpha.md",
        path: "/wiki/entities",
        title: "Alpha Entity",
      },
    ])
    const result = await processMarkdown(
      "[[entities/alpha\\|Alpha Entity]]",
      entityDocs,
    )
    expect(result).toContain("/d/doc-alpha")
    expect(result).toContain("Alpha Entity")
    expect(result).not.toContain("[[")
  })
})
