import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { WikiReaderProvider } from "@/context/WikiReaderContext"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import type { SearchResponse } from "@/types"

const searchDocuments = vi.fn()

vi.mock("@/lib/api", () => ({
  getPublicWikiStatus: vi.fn().mockResolvedValue({ enabled: false }),
  listDocuments: vi.fn().mockResolvedValue([]),
  listPublicDocuments: vi.fn().mockResolvedValue([]),
  getDocument: vi.fn().mockResolvedValue({
    id: "doc-abc",
    filename: "page.md",
    title: "Hello Page",
    path: "/wiki/",
    content: "# Hello",
    file_type: "md",
    page_count: 1,
    tags: [],
    updated_at: "",
  }),
  getPublicDocument: vi.fn(),
  searchDocuments: (...args: unknown[]) => searchDocuments(...args),
  searchPublicWiki: vi.fn(),
}))

describe("Wiki reader shell", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/wiki")
    vi.clearAllMocks()
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

  it("opens search modal from header button", async () => {
    render(
      <WikiReaderProvider>
        <WikiReaderLayout />
      </WikiReaderProvider>,
    )
    await screen.findByText("管理工作台")

    fireEvent.click(screen.getByTitle("搜索 (Ctrl+K)"))
    expect(
      screen.getByPlaceholderText("搜索文件名或内容..."),
    ).toBeInTheDocument()
  })

  it("selects document by document_id from search results", async () => {
    searchDocuments.mockResolvedValueOnce({
      query: "hello",
      results: [
        {
          document_id: "doc-abc",
          content: "hello world content",
          page: 1,
          header_breadcrumb: "",
          chunk_index: 0,
          filename: "page.md",
          title: "Hello Page",
          path: "/wiki/",
          file_type: "md",
          score: 0.5,
        },
      ],
    } satisfies SearchResponse)

    render(
      <WikiReaderProvider>
        <WikiReaderLayout />
      </WikiReaderProvider>,
    )
    await screen.findByText("管理工作台")
    fireEvent.click(screen.getByTitle("搜索 (Ctrl+K)"))

    const input = screen.getByPlaceholderText("搜索文件名或内容...")
    fireEvent.change(input, { target: { value: "hello" } })

    await waitFor(
      () => expect(searchDocuments).toHaveBeenCalledWith("hello"),
      { timeout: 2000 },
    )

    const resultBtn = await waitFor(
      () => screen.getByRole("button", { name: /Hello Page/i }),
      { timeout: 2000 },
    )
    fireEvent.click(resultBtn)

    expect(searchDocuments).toHaveBeenCalledWith("hello")
    expect(window.location.search).toContain("doc=doc-abc")
  })
})
