import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { WikiReaderProvider, useWikiReader } from "@/context/WikiReaderContext"
import { WikiReaderLayout } from "@/components/WikiReaderLayout"
import { Sidebar } from "@/components/Sidebar"
import * as api from "@/lib/api"
import type { SearchResponse, DocumentListItem } from "@/types"

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
  searchDocuments: vi.fn(),
  searchPublicWiki: vi.fn(),
}))

describe("Wiki reader shell", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/wiki")
    vi.clearAllMocks()
    vi.mocked(api.getPublicWikiStatus).mockResolvedValue({ enabled: false })
    vi.mocked(api.listDocuments).mockResolvedValue([])
    vi.mocked(api.listPublicDocuments).mockResolvedValue([])
  })

  it("loads wiki-only documents", async () => {
    render(
      <WikiReaderProvider>
        <WikiReaderLayout />
      </WikiReaderProvider>,
    )
    await screen.findByText("管理工作台")
    await waitFor(() => {
      expect(api.listDocuments).toHaveBeenCalledWith({ source_kind: "wiki", exclude_hidden: true })
    })
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
    vi.mocked(api.searchDocuments).mockResolvedValueOnce({
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
      () =>
        expect(api.searchDocuments).toHaveBeenCalledWith("hello", 10, undefined),
      { timeout: 2000 },
    )

    const resultBtn = await waitFor(
      () => screen.getByRole("button", { name: /Hello Page/i }),
      { timeout: 2000 },
    )
    fireEvent.click(resultBtn)

    expect(api.searchDocuments).toHaveBeenCalledWith("hello", 10, undefined)
    expect(window.location.search).toContain("doc=doc-abc")
  })
})

/** Helper: create sample documents with different page types */
function sampleDocs(): DocumentListItem[] {
  return [
    {
      id: "entity-1",
      filename: "alice.md",
      title: "Alice",
      path: "/wiki/entities/alice.md",
      relative_path: "wiki/entities/alice.md",
      page_type: "entity",
      file_type: "md",
      page_count: 1,
      updated_at: "",
    },
    {
      id: "entity-2",
      filename: "bob.md",
      title: "Bob",
      path: "/wiki/entities/bob.md",
      relative_path: "wiki/entities/bob.md",
      page_type: "entity",
      file_type: "md",
      page_count: 1,
      updated_at: "",
    },
    {
      id: "concept-1",
      filename: "intro.md",
      title: "Introduction",
      path: "/wiki/concepts/intro.md",
      relative_path: "wiki/concepts/intro.md",
      page_type: "concept",
      file_type: "md",
      page_count: 1,
      updated_at: "",
    },
    {
      id: "source-1",
      filename: "paper.md",
      title: "Paper Summary",
      path: "/wiki/sources/paper.md",
      relative_path: "wiki/sources/paper.md",
      page_type: "source",
      file_type: "md",
      page_count: 1,
      updated_at: "",
    },
  ]
}

describe("Sidebar navigation modes", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/wiki")
    vi.clearAllMocks()
    vi.mocked(api.getPublicWikiStatus).mockResolvedValue({ enabled: false })
    vi.mocked(api.listDocuments).mockResolvedValue(sampleDocs())
    vi.mocked(api.listPublicDocuments).mockResolvedValue([])
  })

  /** Get the mode-switcher button by its text (Wiki or 页面). */
  function getModeButton(name: "Wiki" | "页面") {
    // Mode switcher buttons have class "flex-1"
    return screen.getAllByText(name).find((el) =>
      el.classList.contains("flex-1"),
    )!
  }

  it("defaults to Wiki mode", async () => {
    render(
      <WikiReaderProvider>
        <Sidebar variant="reader" />
      </WikiReaderProvider>,
    )

    // Wiki mode button should have the active style
    const wikiBtns = await screen.findAllByText("Wiki")
    const modeBtn = wikiBtns.find((el) => el.classList.contains("flex-1"))!
    expect(modeBtn.className).toContain("bg-point")

    // Wiki mode should show entity + concept docs (not source)
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
      expect(screen.getByText("Bob")).toBeInTheDocument()
      expect(screen.getByText("Introduction")).toBeInTheDocument()
    })
    expect(screen.queryByText("Paper Summary")).not.toBeInTheDocument()
  })

  it("shows mode switcher with Wiki and 页面 options", async () => {
    render(
      <WikiReaderProvider>
        <Sidebar variant="reader" />
      </WikiReaderProvider>,
    )

    await waitFor(() => {
      expect(getModeButton("Wiki")).toBeInTheDocument()
      expect(getModeButton("页面")).toBeInTheDocument()
    })
  })

  it("switches to pages mode and shows tree", async () => {
    render(
      <WikiReaderProvider>
        <Sidebar variant="reader" />
      </WikiReaderProvider>,
    )

    await waitFor(() => expect(getModeButton("Wiki")).toBeInTheDocument())

    // Switch to Pages mode
    fireEvent.click(getModeButton("页面"))

    // Pages mode button should now be active
    expect(getModeButton("页面").className).toContain("bg-point")

    // Pages mode should show all docs in tree including source
    await waitFor(() => {
      const paperNodes = screen.getAllByText("paper.md")
      expect(paperNodes.length).toBeGreaterThanOrEqual(1)
    })
  })

  it("preserves document selection when switching modes", async () => {
    vi.mocked(api.getDocument).mockResolvedValue({
      id: "entity-1",
      filename: "alice.md",
      title: "Alice",
      path: "/wiki/entities/alice.md",
      relative_path: "wiki/entities/alice.md",
      source_kind: "wiki",
      file_type: "md",
      file_size: 100,
      document_number: 0,
      status: "ready",
      page_count: 1,
      content: "# Alice",
      tags: [],
      date: "",
      metadata: "",
      error_message: "",
      version: 0,
      parser: "",
      content_hash: "",
      stale_since: "",
      highlights: "",
      created_at: "",
      updated_at: "",
      user_id: "",
    })

    function SelectorSpy() {
      const { currentDocId } = useWikiReader()
      return <span data-testid="current-doc-id">{currentDocId ?? "none"}</span>
    }

    window.history.replaceState(null, "", "/wiki?doc=entity-1")

    render(
      <WikiReaderProvider>
        <Sidebar variant="reader" />
        <SelectorSpy />
      </WikiReaderProvider>,
    )

    // Wait for document to be selected
    await waitFor(() => {
      expect(screen.getByTestId("current-doc-id").textContent).toBe("entity-1")
    })

    // Switch to Pages mode
    fireEvent.click(getModeButton("页面"))

    // Document selection should be preserved
    expect(screen.getByTestId("current-doc-id").textContent).toBe("entity-1")
  })

  it("Wiki mode shows entities and concepts as separate groups", async () => {
    render(
      <WikiReaderProvider>
        <Sidebar variant="reader" />
      </WikiReaderProvider>,
    )

    // Wait for documents to load
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
      expect(screen.getByText("Bob")).toBeInTheDocument()
      expect(screen.getByText("Introduction")).toBeInTheDocument()
    })

    // Entity section header should show "实体" with count
    const entityHeaders = screen.getAllByText("实体")
    const entitySectionHeader = entityHeaders.find(
      (el) => el.classList.contains("flex-1") === false && el.closest("button"),
    )
    expect(entitySectionHeader).toBeTruthy()

    // Concept section header should show "概念" with count
    const conceptHeaders = screen.getAllByText("概念")
    const conceptSectionHeader = conceptHeaders.find(
      (el) => el.classList.contains("flex-1") === false && el.closest("button"),
    )
    expect(conceptSectionHeader).toBeTruthy()
  })

  it("Wiki mode does not show page type filter", async () => {
    render(
      <WikiReaderProvider>
        <Sidebar variant="reader" />
      </WikiReaderProvider>,
    )

    await waitFor(() => expect(getModeButton("Wiki")).toBeInTheDocument())

    // Type filter label "页面类型" should NOT be present in Wiki mode
    expect(screen.queryByText("页面类型")).not.toBeInTheDocument()
  })

  it("pages mode type filter shows all types", async () => {
    render(
      <WikiReaderProvider>
        <Sidebar variant="reader" />
      </WikiReaderProvider>,
    )

    await waitFor(() => expect(getModeButton("Wiki")).toBeInTheDocument())
    fireEvent.click(getModeButton("页面"))

    // Wait for re-render after mode switch
    await waitFor(() => {
      expect(screen.getByText("来源摘要")).toBeInTheDocument()
    })
  })
})
