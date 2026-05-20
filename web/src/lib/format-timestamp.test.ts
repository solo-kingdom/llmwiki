import { describe, it, expect, vi, afterEach } from "vitest"
import {
  formatGitCommitTimestamp,
  parseGitCommitTimestamp,
} from "@/lib/format-timestamp"

describe("parseGitCommitTimestamp", () => {
  it("parses git %ci format with numeric timezone", () => {
    const date = parseGitCommitTimestamp("2026-05-20 18:53:10 +0800")
    expect(date).not.toBeNull()
    expect(date!.toISOString()).toBe("2026-05-20T10:53:10.000Z")
  })

  it("returns null for unparseable values", () => {
    expect(parseGitCommitTimestamp("not a date")).toBeNull()
  })
})

describe("formatGitCommitTimestamp", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("never returns Invalid Date for git timestamps", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"))
    const label = formatGitCommitTimestamp("2026-05-20 18:53:10 +0800")
    expect(label).not.toBe("Invalid Date")
    expect(label.length).toBeGreaterThan(0)
  })
})
