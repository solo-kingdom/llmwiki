import { describe, expect, it } from "vitest"
import {
  countFileChanges,
  decodeGitPath,
  getFileDisplayPath,
  hasRenderableDiff,
  listDiffFiles,
  parseDiff,
} from "@/lib/parse-unified-diff"
import { inferLanguage } from "@/lib/diff-highlight"

const sampleDiff = `diff --git a/wiki/intro.md b/wiki/intro.md
new file mode 100644
--- /dev/null
+++ b/wiki/intro.md
@@ -0,0 +1,5 @@
+# Introduction
+Hello world
diff --git a/wiki/conclusion.md b/wiki/conclusion.md
--- a/wiki/conclusion.md
+++ b/wiki/conclusion.md
@@ -1,3 +1,4 @@
 line
+added
`

describe("listDiffFiles", () => {
  it("parses multiple files from unified diff", () => {
    const files = listDiffFiles(sampleDiff)
    expect(files).toHaveLength(2)
    expect(getFileDisplayPath(files[0])).toBe("wiki/intro.md")
    expect(getFileDisplayPath(files[1])).toBe("wiki/conclusion.md")
  })

  it("returns empty array for empty diff", () => {
    expect(listDiffFiles("")).toEqual([])
    expect(listDiffFiles("   ")).toEqual([])
  })

  it("counts additions and deletions per file", () => {
    const files = listDiffFiles(sampleDiff)
    expect(countFileChanges(files[0])).toEqual({ additions: 2, deletions: 0 })
    expect(countFileChanges(files[1])).toEqual({ additions: 1, deletions: 0 })
  })

  it("detects renderable vs non-renderable parse results", () => {
    expect(hasRenderableDiff(listDiffFiles(sampleDiff))).toBe(true)
    expect(hasRenderableDiff(listDiffFiles("not a valid unified diff"))).toBe(
      false,
    )
  })
})

describe("decodeGitPath", () => {
  it("decodes octal-escaped UTF-8 paths from git quotepath", () => {
    expect(decodeGitPath("wiki/\\344\\270\\255\\346\\226\\207.md")).toBe(
      "wiki/中文.md",
    )
  })

  it("leaves plain ASCII paths unchanged", () => {
    expect(decodeGitPath("wiki/intro.md")).toBe("wiki/intro.md")
  })

  it("decodes paths in parsed diff file entries", () => {
    const quotedDiff = `diff --git "a/wiki/\\344\\270\\255\\346\\226\\207.md" "b/wiki/\\344\\270\\255\\346\\226\\207.md"
--- a/wiki/\\344\\270\\255\\346\\226\\207.md
+++ b/wiki/\\344\\270\\255\\346\\226\\207.md
@@ -1 +1 @@
-old
+new
`
    const [file] = parseDiff(quotedDiff)
    expect(getFileDisplayPath(file)).toBe("wiki/中文.md")
  })
})

describe("inferLanguage", () => {
  it("maps common wiki extensions", () => {
    expect(inferLanguage("wiki/intro.md")).toBe("markdown")
    expect(inferLanguage("config.json")).toBe("json")
    expect(inferLanguage("main.go")).toBe("go")
    expect(inferLanguage("noext")).toBe("")
  })
})
