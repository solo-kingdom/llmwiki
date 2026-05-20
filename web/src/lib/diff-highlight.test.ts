import { describe, expect, it } from "vitest"
import {
  canHighlightLanguage,
  inferLanguage,
  tokenizeHunks,
} from "@/lib/diff-highlight"
import { parseDiff } from "@/lib/parse-unified-diff"

const sampleDiff = `diff --git a/wiki/intro.md b/wiki/intro.md
--- /dev/null
+++ b/wiki/intro.md
@@ -0,0 +1,2 @@
+# Hi
+line
`

describe("inferLanguage", () => {
  it("maps common wiki extensions", () => {
    expect(inferLanguage("wiki/intro.md")).toBe("markdown")
    expect(inferLanguage("config.json")).toBe("json")
    expect(inferLanguage("main.go")).toBe("go")
  })

  it("returns empty string when no extension", () => {
    expect(inferLanguage("noext")).toBe("")
    expect(canHighlightLanguage("")).toBe(false)
  })
})

describe("canHighlightLanguage", () => {
  it("returns true only for registered grammars", () => {
    expect(canHighlightLanguage("markdown")).toBe(true)
    expect(canHighlightLanguage("plaintext")).toBe(false)
    expect(canHighlightLanguage("unknownlang")).toBe(false)
  })
})

describe("tokenizeHunks", () => {
  it("returns tokens for highlightable languages", () => {
    const [file] = parseDiff(sampleDiff)
    const tokens = tokenizeHunks(file.hunks, "markdown")
    expect(tokens).toBeDefined()
    expect(tokens?.old.length).toBeGreaterThan(0)
  })

  it("returns undefined when language is not registered", () => {
    const [file] = parseDiff(sampleDiff)
    expect(tokenizeHunks(file.hunks, "")).toBeUndefined()
    expect(tokenizeHunks(file.hunks, "plaintext")).toBeUndefined()
  })
})
