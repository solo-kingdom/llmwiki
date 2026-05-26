import { describe, it, expect } from "vitest"
import { extractHeadings, slugifyHeading } from "@/lib/markdown"

describe("extractHeadings", () => {
  it("assigns unique slugs for duplicate heading text", () => {
    const content = ["# Intro", "## Details", "## Details", "### Details"].join(
      "\n",
    )
    const items = extractHeadings(content)
    expect(items.map((i) => i.slug)).toEqual([
      "intro",
      "details",
      "details-1",
      "details-2",
    ])
  })

  it("slugifyHeading normalizes text", () => {
    expect(slugifyHeading("  Hello World!  ")).toBe("hello-world")
  })
})
