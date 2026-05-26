import { describe, it, expect } from "vitest"
import { composeTextBlocksToMarkdown } from "@/lib/compose-text-blocks"

describe("composeTextBlocksToMarkdown", () => {
  it("returns empty string when all blocks are blank", () => {
    expect(
      composeTextBlocksToMarkdown([
        { content: "  " },
        { title: "x", content: "" },
      ]),
    ).toBe("")
  })

  it("joins multiple blocks with headings and separators", () => {
    const md = composeTextBlocksToMarkdown([
      { title: "Intro", content: "First paragraph" },
      { content: "Second block body" },
    ])

    expect(md).toContain("## Intro")
    expect(md).toContain("First paragraph")
    expect(md).toContain("## 文本块 2")
    expect(md).toContain("Second block body")
    expect(md).toContain("---")
  })

  it("uses single block content without auto heading when only one block", () => {
    expect(
      composeTextBlocksToMarkdown([{ content: "solo content" }]),
    ).toBe("solo content")
  })
})
