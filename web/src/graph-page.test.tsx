import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { GraphPage } from "@/components/GraphPage"
import * as api from "@/lib/api"
import { I18nProvider } from "@/i18n"

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
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock)
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
    })
    renderGraphPage()

    expect(
      await screen.findByText("暂无足够页面生成图谱"),
    ).toBeInTheDocument()
  })

  it("navigates to wiki reader when node is clicked", async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue(mockGraph)
    window.history.replaceState(null, "", "/wiki/graph")
    renderGraphPage()

    const pageA = await screen.findByRole("button", { name: "Page A" })
    fireEvent.click(pageA)

    await waitFor(() => {
      expect(window.location.pathname).toBe("/wiki")
      expect(window.location.search).toContain("doc=doc-a")
    })
  })
})
