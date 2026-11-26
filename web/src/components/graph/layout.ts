import type { GraphEdge, GraphNode } from "@/types"

export interface Point {
  x: number
  y: number
}

export interface LayoutNode extends Point {
  id: string
  radius: number
}

interface SimNode extends LayoutNode {
  vx: number
  vy: number
}

function hashSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function graphNodeRadius(node: GraphNode): number {
  return 5 + Math.min(15, Math.log2(1 + Math.max(0, node.link_count)) * 1.6)
}

export function computeGraphLayout(nodes: GraphNode[], edges: GraphEdge[], verticalScale = 1): Map<string, LayoutNode> {
  const maxLinks = Math.max(1, ...nodes.map((node) => node.link_count))
  const spread = Math.max(420, Math.sqrt(nodes.length) * 150)
  const placed: SimNode[] = nodes.map((node) => {
    const next = random(hashSeed(node.id))
    const angle = next() * Math.PI * 2
    const distance = Math.sqrt(next()) * spread
    return {
      id: node.id,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      vx: 0,
      vy: 0,
      radius: graphNodeRadius(node) + Math.min(4, (node.link_count / maxLinks) * 4),
    }
  })
  const indexById = new Map(placed.map((node, index) => [node.id, index]))
  const validEdges = edges.filter((edge) => indexById.has(edge.source) && indexById.has(edge.target))
  const iterations = nodes.length > 300 ? 150 : 190
  const cellSize = 240

  for (let iteration = 0; iteration < iterations; iteration++) {
    const cooling = 1 - (iteration / iterations) * 0.72
    for (const node of placed) {
      node.vx *= 0.82
      node.vy *= 0.82
      node.vx -= node.x * 0.0012 * cooling
      node.vy -= node.y * 0.0012 * cooling
    }

    for (const edge of validEdges) {
      const source = placed[indexById.get(edge.source)!]!
      const target = placed[indexById.get(edge.target)!]!
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.max(0.01, Math.hypot(dx, dy))
      const desired = 100 + source.radius + target.radius
      const force = ((distance - desired) / distance) * 0.018 * cooling
      source.vx += dx * force
      source.vy += dy * force
      target.vx -= dx * force
      target.vy -= dy * force
    }

    const grid = new Map<string, number[]>()
    placed.forEach((node, index) => {
      const key = `${Math.floor(node.x / cellSize)},${Math.floor(node.y / cellSize)}`
      const bucket = grid.get(key)
      if (bucket) bucket.push(index)
      else grid.set(key, [index])
    })

    for (let firstIndex = 0; firstIndex < placed.length; firstIndex++) {
      const first = placed[firstIndex]!
      const cellX = Math.floor(first.x / cellSize)
      const cellY = Math.floor(first.y / cellSize)
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          const bucket = grid.get(`${cellX + offsetX},${cellY + offsetY}`) ?? []
          for (const secondIndex of bucket) {
            if (secondIndex <= firstIndex) continue
            const second = placed[secondIndex]!
            let dx = second.x - first.x
            let dy = second.y - first.y
            let distance = Math.hypot(dx, dy)
            if (distance < 0.01) {
              dx = secondIndex % 2 === 0 ? 0.1 : -0.1
              dy = secondIndex % 3 === 0 ? 0.1 : -0.1
              distance = Math.hypot(dx, dy)
            }
            const minimum = first.radius + second.radius + 20
            if (distance > cellSize && distance > minimum) continue
            const repulsion = Math.min(7, 1250 / (distance * distance)) * cooling
            const collision = distance < minimum ? (minimum - distance) * 0.025 : 0
            const force = repulsion + collision
            first.vx -= (dx / distance) * force
            first.vy -= (dy / distance) * force
            second.vx += (dx / distance) * force
            second.vy += (dy / distance) * force
          }
        }
      }
    }

    for (const node of placed) {
      const speed = Math.hypot(node.vx, node.vy)
      if (speed > 12) {
        node.vx = (node.vx / speed) * 12
        node.vy = (node.vy / speed) * 12
      }
      node.x += node.vx
      node.y += node.vy
    }
  }

  return new Map(placed.map(({ id, x, y, radius }) => [id, { id, x, y: y * verticalScale, radius }]))
}
