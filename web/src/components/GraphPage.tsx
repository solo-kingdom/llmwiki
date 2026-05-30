import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react"
import type { ForceGraphMethods } from "react-force-graph-2d"
import { getKnowledgeGraph } from "@/lib/api"
import { useT } from "@/i18n"
import { useWikiReader } from "@/context/WikiReaderContext"
import type { GraphEdge, GraphNode, KnowledgeGraphResponse } from "@/types"

const ForceGraph2D = lazy(() => import("react-force-graph-2d"))

const TYPE_COLORS: Record<string, string> = {
  entity: "#3b82f6",
  concept: "#8b5cf6",
  source: "#f59e0b",
  synthesis: "#10b981",
  comparison: "#ec4899",
  query: "#6366f1",
  page: "#94a3b8",
}

type ForceNode = GraphNode & { x?: number; y?: number }
type ForceGraphData = { nodes: ForceNode[]; links: GraphEdge[] }

type ForceGraph2DProps = ComponentProps<typeof ForceGraph2D>
type ForceGraph2DWithInitProps = ForceGraph2DProps & {
  onEngineInit?: (fg: ForceGraphMethods) => void
}

function configureForceEngine(fg: ForceGraphMethods) {
  const charge = fg.d3Force("charge")
  if (charge) {
    charge.strength(-120)
    charge.distanceMax(300)
  }
  const link = fg.d3Force("link")
  if (link) {
    link.distance(50)
  }
}

function ForceGraph2DWithInit({ onEngineInit, ...props }: ForceGraph2DWithInitProps) {
  const fgRef = useRef<ForceGraphMethods>(undefined)

  useEffect(() => {
    if (fgRef.current) onEngineInit?.(fgRef.current)
  }, [onEngineInit, props.graphData])

  return (
    <ForceGraph2D
      {...props}
      ref={fgRef}
      {...(onEngineInit ? { onEngineInit } : {})}
    />
  )
}

function isGraphEmpty(data: KnowledgeGraphResponse): boolean {
  if (data.edges.length === 0) return true
  const linked = new Set<string>()
  for (const edge of data.edges) {
    linked.add(edge.source)
    linked.add(edge.target)
  }
  return linked.size < 2
}

export function GraphPage() {
  const t = useT()
  const { selectDocument } = useWikiReader()
  const [graphData, setGraphData] = useState<KnowledgeGraphResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getKnowledgeGraph({ limit: 300 })
      .then((data) => {
        if (!cancelled) setGraphData(data)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const forceData = useMemo<ForceGraphData | null>(() => {
    if (!graphData || isGraphEmpty(graphData)) return null
    return {
      nodes: graphData.nodes.map((n) => ({
        ...n,
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 400,
      })),
      links: graphData.edges.map((e) => ({ ...e })),
    }
  }, [graphData])

  const handleNodeClick = useCallback((node: ForceNode) => {
    if (node.document_id) {
      selectDocument(node.document_id)
    }
  }, [selectDocument])

  const nodeCanvasObject = useCallback(
    (node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.title || node.id
      const color = TYPE_COLORS[node.type] ?? TYPE_COLORS.page
      const radius = Math.max(5, Math.min(14, 5 + (node.link_count || 0)))

      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false)
      ctx.fillStyle = color
      ctx.fill()

      if (globalScale >= 0.4) {
        const fontSize = Math.min(14, Math.max(6, 12 / globalScale))
        ctx.font = `${fontSize}px sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        ctx.fillStyle = "#64748b"
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + radius + 2)
      }
    },
    [],
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      {loading && (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">{t("graph.loading")}</p>
        </div>
      )}
      {error && (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-destructive">
            {t("common.load_failed")}: {error}
          </p>
        </div>
      )}
      {!loading && !error && graphData && isGraphEmpty(graphData) && (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-sm text-muted-foreground">{t("graph.empty")}</p>
        </div>
      )}
      {!loading && !error && forceData && (
        <div
          className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-muted/20"
          data-testid="graph-canvas-container"
        >
          {graphData?.truncated && (
            <span
              className="absolute left-2 top-2 z-10 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm"
              data-testid="graph-truncated-overlay"
            >
              {t("graph.truncated_hint", {
                count: graphData.nodes.length,
                total: graphData.total_nodes,
              })}
            </span>
          )}
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center p-4">
                <p className="text-sm text-muted-foreground">{t("graph.loading")}</p>
              </div>
            }
          >
            <ForceGraph2DWithInit
              graphData={forceData}
              nodeLabel={(n) => (n as ForceNode).title || (n as ForceNode).id}
              nodeCanvasObject={(node, ctx, globalScale) =>
                nodeCanvasObject(node as ForceNode, ctx, globalScale)
              }
              nodePointerAreaPaint={(node, color, ctx) => {
                const n = node as ForceNode
                const radius = Math.max(5, Math.min(14, 5 + (n.link_count || 0)))
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.arc(n.x ?? 0, n.y ?? 0, radius + 2, 0, 2 * Math.PI, false)
                ctx.fill()
              }}
              linkColor={() => "#cbd5e1"}
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={1}
              onEngineInit={configureForceEngine}
              onNodeClick={(node) => handleNodeClick(node as ForceNode)}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              warmupTicks={30}
              cooldownTicks={150}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
