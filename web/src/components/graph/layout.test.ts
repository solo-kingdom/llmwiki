import { describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode } from "@/types"
import { computeGraphLayout, graphNodeRadius } from "./layout"

function makeNodes(count: number): GraphNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `wiki/${index}.md`,
    document_id: String(index),
    title: `Node ${index}`,
    type: "concept",
    link_count: index * 2,
  }))
}

describe("graph layout", () => {
  it("returns deterministic finite positions", () => {
    const nodes = makeNodes(24)
    const edges: GraphEdge[] = nodes.slice(1).map((node, index) => ({
      source: nodes[index]!.id,
      target: node.id,
      type: "links_to",
    }))
    const first = computeGraphLayout(nodes, edges)
    const second = computeGraphLayout(nodes, edges)
    expect([...first.entries()]).toEqual([...second.entries()])
    for (const point of first.values()) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
      expect(point.radius).toBeGreaterThan(0)
    }
  })

  it("handles empty and single-node graphs", () => {
    expect(computeGraphLayout([], []).size).toBe(0)
    const nodes = makeNodes(1)
    expect(computeGraphLayout(nodes, []).get(nodes[0]!.id)).toBeDefined()
  })

  it("lays out 500 connected nodes", () => {
    const nodes = makeNodes(500)
    const edges: GraphEdge[] = nodes.slice(1).map((node, index) => ({
      source: nodes[index % 20]!.id,
      target: node.id,
      type: "links_to",
    }))
    const layout = computeGraphLayout(nodes, edges)
    expect(layout.size).toBe(500)
    for (const point of layout.values()) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
    }
  })

  it("uses link count for node radius", () => {
    const [small, large] = makeNodes(2)
    expect(graphNodeRadius(large!)).toBeGreaterThan(graphNodeRadius(small!))
  })
})
