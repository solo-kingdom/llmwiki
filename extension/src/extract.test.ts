import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildClipContent,
  extractFromDocument,
  htmlToMarkdown,
  webClipFilename,
} from "./extract"

const fixturePath = resolve(__dirname, "../tests/fixtures/article.html")
const fixtureHtml = readFileSync(fixturePath, "utf8")

describe("htmlToMarkdown", () => {
  it("converts headings and paragraphs", () => {
    const markdown = htmlToMarkdown(
      "<h1>Hello</h1><p>World <strong>bold</strong>.</p>",
    )
    expect(markdown).toContain("# Hello")
    expect(markdown).toContain("World **bold**.")
  })
})

describe("buildClipContent", () => {
  it("includes title and source_url frontmatter", () => {
    const content = buildClipContent(
      "示例标题",
      "https://example.com/post",
      "## Section\n\nBody text.",
    )
    expect(content).toContain('title: "示例标题"')
    expect(content).toContain('source_url: "https://example.com/post"')
    expect(content).toContain("# 示例标题")
    expect(content).toContain("## Section")
  })
})

describe("extractFromDocument", () => {
  it("extracts readable article content from fixture", () => {
    document.documentElement.innerHTML = fixtureHtml
    const result = extractFromDocument(document, "https://example.com/article")

    expect(result.title).toBe("Fixture Article Title")
    expect(result.url).toBe("https://example.com/article")
    expect(result.content).toContain('source_url: "https://example.com/article"')
    expect(result.content).toContain("First paragraph with enough text to be readable.")
    expect(result.content).not.toContain("Sidebar noise should be removed.")
  })
})

describe("webClipFilename", () => {
  it("generates canonical web-clip timestamp filename", () => {
    expect(webClipFilename(new Date("2026-05-21T08:30:45.000Z"))).toBe(
      "web-clip-20260521T083045.md",
    )
  })
})
