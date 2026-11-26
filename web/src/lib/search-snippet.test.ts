import { describe, expect, it } from "vitest"
import {
  buildContentSnippet,
  cleanMarkdownForSnippet,
  splitHighlightSegments,
  stripFrontmatterText,
} from "./search-snippet"

describe("search-snippet helpers", () => {
  it("strips YAML frontmatter and cleans markdown syntax", () => {
    const raw = `---
title: Test
type: concept
---

# Heading

See [[wiki/concepts/rag.md|RAG]] and [docs](https://example.com) for \`hybrid_search\`.`
    expect(stripFrontmatterText(raw)).not.toContain("type: concept")
    const cleaned = cleanMarkdownForSnippet(raw)
    expect(cleaned).toBe("Heading See RAG and docs for hybrid_search.")
  })

  it("centers snippet around matched query and adds ellipsis", () => {
    const raw = `${"Intro context ".repeat(12)}PostgreSQL pg_trgm accelerates Chinese substring search.${" tail".repeat(12)}`
    const snippet = buildContentSnippet(raw, "pg_trgm", 72)
    expect(snippet).toContain("pg_trgm")
    expect(snippet.startsWith("…")).toBe(true)
    expect(snippet.endsWith("…")).toBe(true)
  })

  it("splits highlight segments safely with regex special characters", () => {
    const segs = splitHighlightSegments("Use C++ (v2) for C++ engine", "c++")
    expect(segs).toEqual([
      { text: "Use ", match: false },
      { text: "C++", match: true },
      { text: " (v2) for ", match: false },
      { text: "C++", match: true },
      { text: " engine", match: false },
    ])
  })
})
