import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { TimelinePage } from "@/components/TimelinePage"
import * as api from "@/lib/api"
import type { VCLogEntry, VCStatus } from "@/types"

const diffA = `diff --git a/wiki/a.md b/wiki/a.md
--- a/wiki/a.md
+++ b/wiki/a.md
@@ -1 +1 @@
-old
+new
`

const entryA: VCLogEntry = {
  sha: "aaa1111",
  subject: "commit A",
  timestamp: "2026-01-01 00:00:00 +0000",
  files_changed: 1,
  is_rollback: false,
}

const entryB: VCLogEntry = {
  sha: "bbb2222",
  subject: "commit B",
  timestamp: "2026-01-02 00:00:00 +0000",
  files_changed: 0,
  is_rollback: false,
}

vi.mock("@/lib/api", () => ({
  getVCStatus: vi.fn(),
  getVCLog: vi.fn(),
  getVCDiff: vi.fn(),
  createRollback: vi.fn(),
}))

describe("TimelinePage diff loading", () => {
  beforeEach(() => {
    vi.mocked(api.getVCStatus).mockResolvedValue({
      enabled: true,
      commit_count: 2,
      git_available: true,
      git_version: "2.43.0",
      tracked_dirs: ["wiki"],
      excluded_dirs: [],
    } satisfies VCStatus)
    vi.mocked(api.getVCLog).mockResolvedValue([entryB, entryA])
  })

  it("ignores stale diff response when user switches commits", async () => {
    let resolveA: (value: { sha: string; diff: string }) => void
    const diffAPromise = new Promise<{ sha: string; diff: string }>((resolve) => {
      resolveA = resolve
    })

    vi.mocked(api.getVCDiff).mockImplementation((sha) => {
      if (sha === entryA.sha) return diffAPromise
      return Promise.resolve({ sha: entryB.sha, diff: "" })
    })

    render(<TimelinePage />)

    await screen.findByText("commit A")

    const rowA = screen.getByText("commit A").closest(".border") as HTMLElement
    const rowB = screen.getByText("commit B").closest(".border") as HTMLElement

    fireEvent.click(within(rowA).getByRole("button", { name: /Diff/i }))
    fireEvent.click(within(rowB).getByRole("button", { name: /Diff/i }))

    await waitFor(() => {
      expect(screen.getByText("(empty diff)")).toBeInTheDocument()
    })

    resolveA!({ sha: entryA.sha, diff: diffA })

    await new Promise((r) => setTimeout(r, 30))

    expect(screen.getByText("(empty diff)")).toBeInTheDocument()
    expect(screen.queryByText("wiki/a.md")).not.toBeInTheDocument()
  })
})
