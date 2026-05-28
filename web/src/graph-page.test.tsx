import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { GraphPage } from "@/components/GraphPage"
import * as api from "@/lib/api"
import { I18nProvider } from "@/i18n"

const mockSelectDocument = vi.fn()

vi.mock("react-force-graph-2d", () => ({
  default: ({
    onNodeClick,
    graphData,
  }: {
    onNodeClick?: (node: { document_id?: string }) => void
    graphData: { nodes: Array<{ document_id: string; title: string }> }
  }) => (
    <div data-testid="mock-force-graph">
      {graphData.nodes.map((node) => (
        <button
          key={node.document_id}
          type="button"
          onClick={() => onNodeClick?.(node)}
        >
          {node.title}
        </button>
      ))}
    </div>
  ),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getKnowledgeGraph: vi.fn(),
  }
})

vi.mock("@/context/WikiReaderContext", () => ({
  useWikiReader: () => ({
    selectDocument: mockSelectDocument,
  }),
}))

const mockGraph = {
  nodes: [
    {
      id: "wiki/entities/a.md",
      document_id: "doc-a",
      title: "Page A",
      type: "entity",
      link_count: 1,
    },
    {
      id: "wiki/concepts/b.md",
      document_id: "doc-b",
      title: "Page B",
      type: "concept",
      link_count: 1,
    },
  ],
  edges: [
    {
      source: "wiki/entities/a.md",
      target: "wiki/concepts/b.md",
      type: "links_to",
    },
  ],
  total_nodes: 2,
  truncated: false,
}

function renderGraphPage() {
  return render(
    <I18nProvider bootstrapFromSettings={false}>
      <GraphPage />
    </I18nProvider>,
  )
}

describe("GraphPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows loading then renders graph from API", async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue(mockGraph)
    renderGraphPage()

    expect(screen.getByText("加载图谱中…")).toBeInTheDocument()
    expect(await screen.findByTestId("mock-force-graph")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "知识图谱" })).toBeInTheDocument()
  })

  it("shows empty state when fewer than two linked pages", async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue({
      nodes: [
        {
          id: "wiki/entities/a.md",
          document_id: "doc-a",
          title: "Page A",
          type: "entity",
          link_count: 0,
        },
      ],
      edges: [],
      total_nodes: 1,
      truncated: false,
    })
    renderGraphPage()

    expect(
      await screen.findByText("暂无足够页面生成图谱"),
    ).toBeInTheDocument()
  })

  it("calls selectDocument when node is clicked", async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue(mockGraph)
    renderGraphPage()

    const pageA = await screen.findByRole("button", { name: "Page A" })
    fireEvent.click(pageA)

    await waitFor(() => {
      expect(mockSelectDocument).toHaveBeenCalledWith("doc-a")
    })
  })

  it("shows truncation hint when truncated is true", async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue({
      ...mockGraph,
      total_nodes: 500,
      truncated: true,
    })
    renderGraphPage()

    expect(
      await screen.findByText("显示前 2 个枢纽节点（共 500 个）"),
    ).toBeInTheDocument()
  })

  it("does not show truncation hint when not truncated", async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue(mockGraph)
    renderGraphPage()

    await screen.findByTestId("mock-force-graph")
    expect(screen.queryByText(/枢纽节点/)).not.toBeInTheDocument()
  })

  it("calls getKnowledgeGraph with limit parameter", async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue(mockGraph)
    renderGraphPage()

    await screen.findByTestId("mock-force-graph")
    expect(api.getKnowledgeGraph).toHaveBeenCalledWith({ limit: 300 })
  })
})
