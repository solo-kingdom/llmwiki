import * as React from "react"
import type { GraphEdge, GraphNode } from "@/types"
import { Num } from "@/components/blocks/format"
import { easeCamera, fitCamera, panCamera, worldToScreen, zoomCameraAt, type CameraState } from "./camera"
import { buildAdjacency, createOverviewEdges, getNeighborhood, visibleGraphNodes } from "./graph-model"
import { computeGraphLayout, type Point } from "./layout"
import { createStars, readGraphPalette, renderGraph, type GraphPalette } from "./renderer"
import "./graph.css"

export interface KnowledgeGraphCanvasHandle {
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  centerOn: (nodeId: string) => void
}

interface KnowledgeGraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedId: string | null
  neighborhood: ReadonlySet<string>
  focused: boolean
  onSelect: (nodeId: string) => void
}

interface TooltipState {
  node: GraphNode
  x: number
  y: number
}

const DEFAULT_CAMERA: CameraState = { centerX: 0, centerY: 0, scale: 1 }

export const KnowledgeGraphCanvas = React.forwardRef<KnowledgeGraphCanvasHandle, KnowledgeGraphCanvasProps>(
  function KnowledgeGraphCanvas({ nodes, edges, selectedId, neighborhood, focused, onSelect }, ref) {
    const wrapRef = React.useRef<HTMLDivElement>(null)
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    const cameraRef = React.useRef<CameraState>(DEFAULT_CAMERA)
    const cameraTargetRef = React.useRef<CameraState>(DEFAULT_CAMERA)
    const viewportRef = React.useRef({ width: 1, height: 1, dpr: 1 })
    const hoveredRef = React.useRef<string | null>(null)
    const needsRenderRef = React.useRef(true)
    const pointersRef = React.useRef(new Map<number, Point>())
    const dragRef = React.useRef({ x: 0, y: 0, moved: false })
    const pinchRef = React.useRef<{ distance: number; midpoint: Point; camera: CameraState } | null>(null)
    const onSelectRef = React.useRef(onSelect)
    onSelectRef.current = onSelect

    const [tooltip, setTooltip] = React.useState<TooltipState | null>(null)
    const [palette, setPalette] = React.useState<GraphPalette | null>(null)
    const [reducedMotion, setReducedMotion] = React.useState(false)
    const [verticalScale, setVerticalScale] = React.useState(1)
    const stars = React.useMemo(() => createStars(), [])
    const layout = React.useMemo(() => computeGraphLayout(nodes, edges, verticalScale), [nodes, edges, verticalScale])
    const adjacency = React.useMemo(() => buildAdjacency(nodes, edges), [nodes, edges])
    const visibleNodes = React.useMemo(
      () => visibleGraphNodes(nodes, neighborhood, focused),
      [nodes, neighborhood, focused],
    )
    const visibleIds = React.useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
    const visibleEdges = React.useMemo(
      () => focused ? edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)) : edges,
      [edges, focused, visibleIds],
    )
    const overviewEdges = React.useMemo(() => createOverviewEdges(visibleNodes, visibleEdges), [visibleNodes, visibleEdges])

    const fitVisible = React.useCallback(() => {
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const points = visibleNodes.map((node) => layout.get(node.id)).filter((point) => point !== undefined)
      const camera = fitCamera(points, rect.width, rect.height, rect.width < 560 ? 72 : 76)
      cameraTargetRef.current = camera
      if (cameraRef.current.scale === 1 && cameraRef.current.centerX === 0 && cameraRef.current.centerY === 0) {
        cameraRef.current = camera
      }
      needsRenderRef.current = true
    }, [layout, visibleNodes])

    React.useImperativeHandle(ref, () => ({
      zoomIn: () => {
        const { width, height } = viewportRef.current
        cameraTargetRef.current = zoomCameraAt(cameraTargetRef.current, { x: width / 2, y: height / 2 }, 1.35, width, height)
        needsRenderRef.current = true
      },
      zoomOut: () => {
        const { width, height } = viewportRef.current
        cameraTargetRef.current = zoomCameraAt(cameraTargetRef.current, { x: width / 2, y: height / 2 }, 1 / 1.35, width, height)
        needsRenderRef.current = true
      },
      reset: fitVisible,
      centerOn: (nodeId) => {
        const point = layout.get(nodeId)
        if (!point) return
        const scale = Math.max(cameraTargetRef.current.scale, 0.9)
        cameraTargetRef.current = { centerX: point.x, centerY: point.y, scale }
        needsRenderRef.current = true
      },
    }), [fitVisible, layout])

    React.useEffect(() => {
      fitVisible()
    }, [fitVisible])

    React.useEffect(() => {
      const wrap = wrapRef.current
      if (!wrap) return
      const update = () => setPalette(readGraphPalette(wrap))
      update()
      const observer = new MutationObserver(update)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] })
      return () => observer.disconnect()
    }, [])

    React.useEffect(() => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)")
      const update = () => {
        setReducedMotion(media.matches)
        needsRenderRef.current = true
      }
      update()
      media.addEventListener("change", update)
      return () => media.removeEventListener("change", update)
    }, [])

    React.useEffect(() => {
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      if (!canvas || !wrap || !palette) return
      const context = canvas.getContext("2d")
      if (!context) return
      let animation = 0
      let previousTime = 0
      let previousFrame = 0

      const resize = () => {
        const rect = wrap.getBoundingClientRect()
        const width = Math.max(1, Math.round(rect.width))
        const height = Math.max(1, Math.round(rect.height))
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        if (viewportRef.current.width === width && viewportRef.current.height === height && viewportRef.current.dpr === dpr) return
        viewportRef.current = { width, height, dpr }
        const nextVerticalScale = width < 560 ? Math.min(1.6, Math.max(1.35, (height / width) * 0.78)) : 1
        setVerticalScale((current) => Math.abs(current - nextVerticalScale) > 0.01 ? nextVerticalScale : current)
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
        needsRenderRef.current = true
      }
      resize()
      const observer = new ResizeObserver(resize)
      observer.observe(wrap)

      const frame = (time: number) => {
        resize()
        const elapsed = previousTime === 0 ? 16.7 : Math.min(80, time - previousTime)
        previousTime = time
        const eased = easeCamera(cameraRef.current, cameraTargetRef.current, elapsed)
        cameraRef.current = eased.camera
        const shouldDraw = needsRenderRef.current || !eased.settled || (!reducedMotion && time - previousFrame >= 1000 / 30)
        if (shouldDraw) {
          const { width, height, dpr } = viewportRef.current
          context.setTransform(dpr, 0, 0, dpr, 0, 0)
          renderGraph(context, width, height, {
            nodes: visibleNodes,
            edges: selectedId === null && hoveredRef.current === null ? overviewEdges : visibleEdges,
            layout,
            camera: cameraRef.current,
            selectedId,
            hoveredId: hoveredRef.current,
            neighborhood: hoveredRef.current !== null
              ? getNeighborhood(adjacency, hoveredRef.current)
              : neighborhood,
            palette,
            time,
            reducedMotion,
            stars,
          })
          needsRenderRef.current = false
          previousFrame = time
        }
        animation = requestAnimationFrame(frame)
      }
      animation = requestAnimationFrame(frame)
      return () => {
        cancelAnimationFrame(animation)
        observer.disconnect()
      }
    }, [adjacency, layout, neighborhood, overviewEdges, palette, reducedMotion, selectedId, stars, visibleEdges, visibleNodes])

    const canvasPoint = (event: { clientX: number; clientY: number }): Point => {
      const rect = canvasRef.current!.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    const hitTest = (screen: Point): GraphNode | null => {
      const { width, height } = viewportRef.current
      let closest: GraphNode | null = null
      let closestDistance = Infinity
      for (const node of visibleNodes) {
        const point = layout.get(node.id)
        if (!point) continue
        const position = worldToScreen(cameraRef.current, point, width, height)
        const distance = Math.hypot(position.x - screen.x, position.y - screen.y)
        const hitRadius = Math.max(15, point.radius * cameraRef.current.scale + 5)
        if (distance <= hitRadius && distance < closestDistance) {
          closest = node
          closestDistance = distance
        }
      }
      return closest
    }

    const updateHover = (screen: Point) => {
      const hit = hitTest(screen)
      const nextId = hit?.id ?? null
      if (hoveredRef.current !== nextId) {
        hoveredRef.current = nextId
        needsRenderRef.current = true
      }
      setTooltip(hit ? { node: hit, x: screen.x, y: screen.y } : null)
    }

    const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      const point = canvasPoint(event)
      pointersRef.current.set(event.pointerId, point)
      dragRef.current = { x: point.x, y: point.y, moved: pointersRef.current.size > 1 }
      setTooltip(null)
      hoveredRef.current = null
      if (pointersRef.current.size === 2) {
        const pointerPoints = [...pointersRef.current.values()]
        const first = pointerPoints[0]!
        const second = pointerPoints[1]!
        pinchRef.current = {
          distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
          midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
          camera: cameraRef.current,
        }
      }
    }

    const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = canvasPoint(event)
      if (!pointersRef.current.has(event.pointerId)) {
        updateHover(point)
        return
      }
      pointersRef.current.set(event.pointerId, point)
      const pinch = pinchRef.current
      if (pinch && pointersRef.current.size >= 2) {
        const pointerPoints = [...pointersRef.current.values()]
        const first = pointerPoints[0]!
        const second = pointerPoints[1]!
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y))
        const { width, height } = viewportRef.current
        const zoomed = zoomCameraAt(pinch.camera, pinch.midpoint, distance / pinch.distance, width, height)
        const moved = panCamera(zoomed, { x: midpoint.x - pinch.midpoint.x, y: midpoint.y - pinch.midpoint.y })
        cameraRef.current = moved
        cameraTargetRef.current = moved
        dragRef.current.moved = true
      } else {
        const delta = { x: point.x - dragRef.current.x, y: point.y - dragRef.current.y }
        if (Math.hypot(delta.x, delta.y) > 2) dragRef.current.moved = true
        const moved = panCamera(cameraRef.current, delta)
        cameraRef.current = moved
        cameraTargetRef.current = moved
        dragRef.current.x = point.x
        dragRef.current.y = point.y
      }
      needsRenderRef.current = true
    }

    const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = canvasPoint(event)
      const wasPinching = pinchRef.current !== null
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
      if (!dragRef.current.moved && !wasPinching) {
        const hit = hitTest(point)
        if (hit) onSelectRef.current(hit.id)
      }
      dragRef.current.moved = pointersRef.current.size > 0
      needsRenderRef.current = true
    }

    const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault()
      const point = canvasPoint(event)
      const { width, height } = viewportRef.current
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      cameraTargetRef.current = zoomCameraAt(cameraTargetRef.current, point, Math.exp(-delta * 0.0015), width, height)
      needsRenderRef.current = true
    }

    return (
      <div ref={wrapRef} className="graph-canvas-host" data-scroll-region="graph">
        <canvas
          ref={canvasRef}
          className="graph-canvas"
          role="img"
          aria-label="知识图谱画布。使用节点列表或搜索选择节点，使用缩放按钮浏览。"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            if (pointersRef.current.size === 0) {
              hoveredRef.current = null
              setTooltip(null)
              needsRenderRef.current = true
            }
          }}
          onWheel={onWheel}
        />
        {tooltip ? (
          <div
            className="graph-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: `translate(${tooltip.x > viewportRef.current.width * 0.64 ? "calc(-100% - 14px)" : "14px"}, ${tooltip.y > viewportRef.current.height * 0.7 ? "calc(-100% - 14px)" : "14px"})`,
            }}
          >
            <strong>{tooltip.node.title || tooltip.node.id}</strong>
            <span>{tooltip.node.type} · <Num value={tooltip.node.link_count} /> 条关联</span>
          </div>
        ) : null}
      </div>
    )
  },
)
