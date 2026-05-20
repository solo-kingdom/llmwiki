import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { WikiReaderProvider } from "@/context/WikiReaderContext"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"

vi.mock("@/lib/api", () => ({
  getPublicWikiStatus: vi.fn().mockResolvedValue({ enabled: false }),
  listDocuments: vi.fn().mockResolvedValue([]),
  listPublicDocuments: vi.fn().mockResolvedValue([]),
  getDocument: vi.fn(),
  getPublicDocument: vi.fn(),
  searchDocuments: vi.fn(),
  searchPublicWiki: vi.fn(),
}))

describe("Wiki reader shell", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/wiki")
  })

  it("renders reader header without management tabs", async () => {
    render(
      <WikiReaderProvider>
        <WikiReaderLayout />
      </WikiReaderProvider>,
    )
    expect(await screen.findByText("管理工作台")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Ingest" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument()
  })
})
