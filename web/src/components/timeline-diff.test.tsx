import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { TimelinePage } from "@/components/TimelinePage"
import * as api from "@/lib/api"
import type { ChangeSet } from "@/types"
import { I18nTestProvider } from "@/test/i18n"

const diffA = `diff --git a/wiki/a.md b/wiki/a.md
--- a/wiki/a.md
+++ b/wiki/a.md
@@ -1 +1 @@
-old
+new
`

const entryA: ChangeSet = {
  id: "aaa1111",
  kind: "ingest",
  summary: "change A",
  page_count: 1,
  created_at: "2026-01-01 00:00:00",
}

const entryB: ChangeSet = {
  id: "bbb2222",
  kind: "rollback",
  summary: "change B",
  page_count: 0,
  rollback_of: "aaa1111",
  created_at: "2026-01-02 00:00:00",
}

vi.mock("@/lib/api", () => ({
  listHistory: vi.fn(),
  getHistory: vi.fn(),
  getHistoryDiff: vi.fn(),
  rollbackHistory: vi.fn(),
}))

describe("TimelinePage history loading", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/timeline")
    vi.clearAllMocks()
    vi.mocked(api.listHistory).mockResolvedValue({ changes: [entryB, entryA] })
    vi.mocked(api.getHistory).mockResolvedValue({
      change_set: entryA,
      pages: [
        {
          id: "rev-1",
          relative_path: "wiki/a.md",
          revision_no: 1,
          change_set_id: entryA.id,
          operation: "update",
          title: "A",
          content: "",
          metadata: "",
          content_hash: "",
          source_kind: "",
          file_type: "",
          actor: "",
          created_at: "",
        },
      ],
    })
  })

  it("renders change sets with kind, summary and page count", async () => {
    render(
      <I18nTestProvider lang="en">
        <TimelinePage />
      </I18nTestProvider>,
    )

    expect(await screen.findByText("change A")).toBeInTheDocument()
    expect(screen.getByText("change B")).toBeInTheDocument()
    expect(screen.getByText("1 page(s)")).toBeInTheDocument()
    expect(screen.getByText("Ingest")).toBeInTheDocument()
    expect(screen.getAllByText("Rollback").length).toBeGreaterThan(0)
  })

  it("shows empty state when there are no change sets", async () => {
    vi.mocked(api.listHistory).mockResolvedValue({ changes: [] })

    render(
      <I18nTestProvider lang="en">
        <TimelinePage />
      </I18nTestProvider>,
    )

    expect(await screen.findByText("No changes yet")).toBeInTheDocument()
  })

  it("ignores stale diff response when user switches change sets", async () => {
    let resolveA: (value: { diff: string }) => void
    const diffAPromise = new Promise<{ diff: string }>((resolve) => {
      resolveA = resolve
    })

    vi.mocked(api.getHistoryDiff).mockImplementation((id) => {
      if (id === entryA.id) return diffAPromise
      return Promise.resolve({ diff: "" })
    })

    render(
      <I18nTestProvider lang="en">
        <TimelinePage />
      </I18nTestProvider>,
    )

    await screen.findByText("change A")

    const rowA = screen.getByText("change A").closest(".border") as HTMLElement
    const rowB = screen.getByText("change B").closest(".border") as HTMLElement

    fireEvent.click(within(rowA).getByRole("button", { name: /Diff/i }))
    fireEvent.click(within(rowB).getByRole("button", { name: /Diff/i }))

    await waitFor(() => {
      expect(screen.getByText("(empty diff)")).toBeInTheDocument()
    })

    resolveA!({ diff: diffA })

    await new Promise((r) => setTimeout(r, 30))

    expect(screen.getByText("(empty diff)")).toBeInTheDocument()
    expect(screen.queryByText("wiki/a.md")).not.toBeInTheDocument()
  })

  it("opens details dialog from the detail button", async () => {
    render(
      <I18nTestProvider lang="en">
        <TimelinePage />
      </I18nTestProvider>,
    )

    await screen.findByText("change A")
    const rowA = screen.getByText("change A").closest(".border") as HTMLElement
    fireEvent.click(within(rowA).getByRole("button", { name: /Details/i }))

    await waitFor(() => {
      expect(api.getHistory).toHaveBeenCalledWith(entryA.id)
    })
    expect(await screen.findByText("wiki/a.md")).toBeInTheDocument()
    expect(screen.getByText("r1")).toBeInTheDocument()
  })

  it("opens diff dialog from change query parameter", async () => {
    window.history.replaceState(null, "", "/timeline?change=aaa1111")
    vi.mocked(api.getHistoryDiff).mockResolvedValue({ diff: diffA })

    render(
      <I18nTestProvider lang="en">
        <TimelinePage />
      </I18nTestProvider>,
    )

    await waitFor(() => {
      expect(api.getHistoryDiff).toHaveBeenCalledWith("aaa1111")
    })
    expect(await screen.findByText("change A")).toBeInTheDocument()
  })
})
