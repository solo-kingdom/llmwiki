import type { GraphEdge, GraphNode } from "@/types"

export function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = new Map<string, Set<string>>()
  for (const node of nodes) adjacency.set(node.id, new Set())
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }
  return adjacency
}

export function getNeighborhood(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  nodeId: string | null,
): ReadonlySet<string> {
  if (nodeId === null || !adjacency.has(nodeId)) return new Set()
  return new Set([nodeId, ...(adjacency.get(nodeId) ?? [])])
}

export function filterGraphNodes(nodes: GraphNode[], query: string): GraphNode[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === "") return nodes
  return nodes
    .map((node, index) => {
      const title = (node.title || node.id).toLocaleLowerCase()
      const path = node.id.toLocaleLowerCase()
      const titleIndex = title.indexOf(normalized)
      const pathIndex = path.indexOf(normalized)
      const rank = titleIndex === 0 ? 0 : titleIndex > 0 ? 1 : pathIndex >= 0 ? 2 : -1
      return { node, index, rank }
    })
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.node.link_count - a.node.link_count || a.index - b.index)
    .map((item) => item.node)
}

export function visibleGraphNodes(
  nodes: GraphNode[],
  neighborhood: ReadonlySet<string>,
  focused: boolean,
): GraphNode[] {
  return focused && neighborhood.size > 0 ? nodes.filter((node) => neighborhood.has(node.id)) : nodes
}

export function createOverviewEdges(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
  if (nodes.length <= 80 || edges.length <= nodes.length) return edges
  const linkCounts = new Map(nodes.map((node) => [node.id, node.link_count]))
  const ranked = edges.map((edge, index) => ({
    edge,
    index,
    score: Math.log1p(linkCounts.get(edge.source) ?? 0) + Math.log1p(linkCounts.get(edge.target) ?? 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index)
  const parent = new Map(nodes.map((node) => [node.id, node.id]))
  const find = (id: string): string => {
    const root = parent.get(id)
    if (root === undefined || root === id) return id
    const next = find(root)
    parent.set(id, next)
    return next
  }
  const selected = new Set<number>()
  for (const item of ranked) {
    const source = find(item.edge.source)
    const target = find(item.edge.target)
    if (source === target) continue
    parent.set(source, target)
    selected.add(item.index)
  }
  const extraBudget = Math.ceil(nodes.length * (nodes.length > 200 ? 0.2 : 0.35))
  let extras = 0
  for (const item of ranked) {
    if (extras >= extraBudget) break
    if (selected.has(item.index)) continue
    selected.add(item.index)
    extras++
  }
  return edges.filter((_, index) => selected.has(index))
}
