import { describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode } from "@/types"
import { buildAdjacency, createOverviewEdges, filterGraphNodes, getNeighborhood, visibleGraphNodes } from "./graph-model"

const nodes: GraphNode[] = [
  { id: "wiki/a.md", document_id: "a", title: "Alpha", type: "concept", link_count: 3 },
  { id: "wiki/b.md", document_id: "b", title: "Beta", type: "entity", link_count: 8 },
  { id: "wiki/c.md", document_id: "c", title: "Alphabet", type: "page", link_count: 5 },
]
const edges: GraphEdge[] = [
  { source: "wiki/a.md", target: "wiki/b.md", type: "links_to" },
  { source: "wiki/b.md", target: "wiki/c.md", type: "links_to" },
]

describe("graph model", () => {
  it("builds an undirected one-hop neighborhood", () => {
    const adjacency = buildAdjacency(nodes, edges)
    expect([...getNeighborhood(adjacency, "wiki/b.md")].sort()).toEqual(["wiki/a.md", "wiki/b.md", "wiki/c.md"])
    expect([...getNeighborhood(adjacency, "wiki/a.md")].sort()).toEqual(["wiki/a.md", "wiki/b.md"])
    expect(getNeighborhood(adjacency, null).size).toBe(0)
  })

  it("ranks title prefix matches before path matches", () => {
    expect(filterGraphNodes(nodes, "alpha").map((node) => node.id)).toEqual(["wiki/c.md", "wiki/a.md"])
    expect(filterGraphNodes(nodes, "B.MD").map((node) => node.id)).toEqual(["wiki/b.md"])
    expect(filterGraphNodes(nodes, " ")).toEqual(nodes)
  })

  it("only narrows visible nodes in focus mode", () => {
    const neighborhood = getNeighborhood(buildAdjacency(nodes, edges), "wiki/a.md")
    expect(visibleGraphNodes(nodes, neighborhood, true).map((node) => node.id)).toEqual(["wiki/a.md", "wiki/b.md"])
    expect(visibleGraphNodes(nodes, neighborhood, false)).toEqual(nodes)
  })

  it("keeps a deterministic connected backbone for dense overviews", () => {
    const manyNodes = Array.from({ length: 120 }, (_, index) => ({
      ...nodes[0]!,
      id: `wiki/${index}.md`,
      link_count: 120 - index,
    }))
    const manyEdges: GraphEdge[] = manyNodes.slice(1).flatMap((node, index) => [
      { source: manyNodes[index]!.id, target: node.id, type: "links_to" },
      { source: manyNodes[0]!.id, target: node.id, type: "links_to" },
    ])
    const overview = createOverviewEdges(manyNodes, manyEdges)
    expect(overview.length).toBeGreaterThanOrEqual(119)
    expect(overview.length).toBeLessThan(manyEdges.length)
    expect(createOverviewEdges(manyNodes, manyEdges)).toEqual(overview)
    expect(createOverviewEdges(nodes, edges)).toEqual(edges)
  })
})
