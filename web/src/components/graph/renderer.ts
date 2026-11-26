import type { GraphEdge, GraphNode } from "@/types"
import type { CameraState } from "./camera"
import { worldToScreen } from "./camera"
import type { LayoutNode } from "./layout"

export interface GraphPalette {
  star: string
  edge: string
  label: string
  labelBackground: string
  selection: string
  page: string
  entity: string
  concept: string
}

interface Star {
  x: number
  y: number
  radius: number
  alpha: number
  phase: number
}

interface LabelCandidate {
  node: GraphNode
  point: LayoutNode
  screen: { x: number; y: number }
  priority: number
}

export interface RenderGraphOptions {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layout: ReadonlyMap<string, LayoutNode>
  camera: CameraState
  selectedId: string | null
  hoveredId: string | null
  neighborhood: ReadonlySet<string>
  palette: GraphPalette
  time: number
  reducedMotion: boolean
  stars: Star[]
}

export function readGraphPalette(element: HTMLElement): GraphPalette {
  const styles = getComputedStyle(element)
  const read = (name: string) => styles.getPropertyValue(name).trim()
  return {
    star: read("--graph-star"),
    edge: read("--graph-edge"),
    label: read("--graph-label"),
    labelBackground: read("--graph-label-background"),
    selection: read("--graph-selection"),
    page: read("--graph-page"),
    entity: read("--graph-entity"),
    concept: read("--graph-concept"),
  }
}

export function createStars(seed = 2026): Star[] {
  let state = seed >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  return Array.from({ length: 260 }, () => ({
    x: next(),
    y: next(),
    radius: 0.35 + next() * 1.15,
    alpha: 0.12 + next() * 0.36,
    phase: next() * Math.PI * 2,
  }))
}

function nodeColor(palette: GraphPalette, type: string): string {
  if (type === "page") return palette.page
  if (type === "entity") return palette.entity
  return palette.concept
}

function truncateLabel(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value
  let text = value
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1)
  return `${text}…`
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  options: RenderGraphOptions,
  width: number,
  height: number,
) {
  const { palette, camera, stars, time, reducedMotion } = options
  const count = Math.min(stars.length, Math.max(70, Math.round((width * height) / 6500)))
  ctx.fillStyle = palette.star
  for (let index = 0; index < count; index++) {
    const star = stars[index]!
    const offsetX = camera.centerX * camera.scale * 0.012
    const offsetY = camera.centerY * camera.scale * 0.012
    const x = (((star.x * width + offsetX) % width) + width) % width
    const y = (((star.y * height + offsetY) % height) + height) % height
    const pulse = reducedMotion ? 0.8 : 0.7 + Math.sin(time * 0.00045 + star.phase) * 0.2
    ctx.globalAlpha = star.alpha * pulse
    ctx.beginPath()
    ctx.arc(x, y, star.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  options: RenderGraphOptions,
  width: number,
  height: number,
) {
  const { edges, layout, camera, selectedId, hoveredId, neighborhood, palette, time, reducedMotion } = options
  const emphasisId = hoveredId ?? selectedId
  ctx.strokeStyle = palette.edge
  ctx.lineCap = "round"
  for (const edge of edges) {
    const source = layout.get(edge.source)
    const target = layout.get(edge.target)
    if (!source || !target) continue
    const from = worldToScreen(camera, source, width, height)
    const to = worldToScreen(camera, target, width, height)
    if ((from.x < -80 && to.x < -80) || (from.x > width + 80 && to.x > width + 80)
      || (from.y < -80 && to.y < -80) || (from.y > height + 80 && to.y > height + 80)) continue
    const active = emphasisId !== null && (edge.source === emphasisId || edge.target === emphasisId)
    const inNeighborhood = neighborhood.has(edge.source) && neighborhood.has(edge.target)
    ctx.globalAlpha = active ? 0.8 : emphasisId !== null ? inNeighborhood ? 0.12 : 0.025 : 0.24
    ctx.lineWidth = active ? 1.35 : 0.75
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()

    if (active && !reducedMotion) {
      const seed = [...`${edge.source}${edge.target}`].reduce((sum, char) => sum + char.charCodeAt(0), 0)
      const progress = (time * 0.00016 + (seed % 100) / 100) % 1
      const fade = Math.sin(progress * Math.PI)
      ctx.globalAlpha = fade * 0.85
      ctx.fillStyle = palette.selection
      ctx.beginPath()
      ctx.arc(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  options: RenderGraphOptions,
  width: number,
  height: number,
): LabelCandidate[] {
  const { nodes, layout, camera, selectedId, hoveredId, neighborhood, palette } = options
  const emphasisId = hoveredId ?? selectedId
  const candidates: LabelCandidate[] = []
  for (const node of nodes) {
    const point = layout.get(node.id)
    if (!point) continue
    const screen = worldToScreen(camera, point, width, height)
    if (screen.x < -60 || screen.x > width + 60 || screen.y < -60 || screen.y > height + 60) continue
    const selected = node.id === selectedId
    const hovered = node.id === hoveredId
    const related = neighborhood.has(node.id)
    const dimmed = emphasisId !== null && !related
    const radius = Math.max(2.2, point.radius * camera.scale * (selected || hovered ? 1.18 : 0.72))
    const color = nodeColor(palette, node.type)

    if (!dimmed) {
      const glow = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius * 3.4)
      glow.addColorStop(0, color)
      glow.addColorStop(1, "transparent")
      ctx.globalAlpha = selected || hovered ? 0.32 : 0.09
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * 3.4, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = dimmed ? 0.1 : selected || hovered ? 1 : 0.78
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fill()

    if (selected || hovered) {
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = palette.selection
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius + 5, 0, Math.PI * 2)
      ctx.stroke()
    }

    candidates.push({
      node,
      point,
      screen,
      priority: selected ? 10000 : hovered ? 9000 : related && emphasisId !== null ? 5000 + node.link_count : node.link_count,
    })
  }
  ctx.globalAlpha = 1
  return candidates
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  options: RenderGraphOptions,
  candidates: LabelCandidate[],
  width: number,
  height: number,
) {
  const { camera, palette, selectedId, hoveredId } = options
  const fontSize = 12
  ctx.font = `${fontSize}px "Inter Variable", "PingFang SC", sans-serif`
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"
  const boxes: { x: number; y: number; width: number; height: number }[] = []
  const limit = Math.min(48, Math.max(10, Math.round((width * height) / 42000)) + (camera.scale > 1.3 ? 16 : 0))
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority)
  let placedCount = 0

  for (const candidate of sorted) {
    if (placedCount >= limit) break
    const required = candidate.node.id === selectedId || candidate.node.id === hoveredId
    const title = candidate.node.title || candidate.node.id
    const text = truncateLabel(ctx, title, 156)
    const textWidth = ctx.measureText(text).width
    const boxWidth = textWidth + 12
    const boxHeight = 22
    const radius = Math.max(3, candidate.point.radius * camera.scale * 0.72)
    const positions = [
      { x: candidate.screen.x + radius + 8, y: candidate.screen.y - boxHeight / 2 },
      { x: candidate.screen.x - textWidth / 2 - 6, y: candidate.screen.y + radius + 7 },
      { x: candidate.screen.x - boxWidth - radius - 8, y: candidate.screen.y - boxHeight / 2 },
      { x: candidate.screen.x - textWidth / 2 - 6, y: candidate.screen.y - radius - boxHeight - 7 },
    ]
    const position = positions.find((box) => {
      if (box.x < 4 || box.x + boxWidth > width - 4 || box.y < 4 || box.y + boxHeight > height - 4) return false
      return !boxes.some((other) => box.x < other.x + other.width + 3 && box.x + boxWidth + 3 > other.x
        && box.y < other.y + other.height + 3 && box.y + boxHeight + 3 > other.y)
    })
    if (!position) {
      if (required) continue
      continue
    }
    boxes.push({ x: position.x, y: position.y, width: boxWidth, height: boxHeight })
    ctx.globalAlpha = 0.88
    ctx.fillStyle = palette.labelBackground
    ctx.beginPath()
    ctx.roundRect(position.x, position.y, boxWidth, boxHeight, 5)
    ctx.fill()
    ctx.globalAlpha = 0.96
    ctx.fillStyle = palette.label
    ctx.fillText(text, position.x + 6, position.y + boxHeight / 2 + 0.5)
    placedCount++
  }
  ctx.globalAlpha = 1
}

export function renderGraph(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: RenderGraphOptions,
) {
  ctx.clearRect(0, 0, width, height)
  drawBackground(ctx, options, width, height)
  drawEdges(ctx, options, width, height)
  const candidates = drawNodes(ctx, options, width, height)
  drawLabels(ctx, options, candidates, width, height)
}
