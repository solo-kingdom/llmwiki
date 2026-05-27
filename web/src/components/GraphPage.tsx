import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getKnowledgeGraph } from "@/lib/api"
import { useT } from "@/i18n"
import { navigateTo, wikiReaderHref } from "@/lib/wiki-routes"
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
  const containerRef = useRef<HTMLDivElement>(null)
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
      navigateTo(wikiReaderHref(node.document_id))
    }
  }, [])

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t("graph.title")}</h1>
        {graphData?.truncated && (
          <span className="text-xs text-muted-foreground">
            {t("graph.truncated_hint", { count: graphData.nodes.length, total: graphData.total_nodes })}
          </span>
        )}
      </div>
      {loading && (
        <p className="text-sm text-muted-foreground">{t("graph.loading")}</p>
      )}
      {error && (
        <p className="text-sm text-destructive">
          {t("common.load_failed")}: {error}
        </p>
      )}
      {!loading && !error && graphData && isGraphEmpty(graphData) && (
        <p className="text-sm text-muted-foreground">{t("graph.empty")}</p>
      )}
      {!loading && !error && forceData && (
        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted/20"
          data-testid="graph-canvas-container"
        >
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">{t("graph.loading")}</p>}>
            <ForceGraph2D
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
              onNodeClick={(node) => handleNodeClick(node as ForceNode)}
              onEngineInit={(fg) => {
                const charge = fg.d3Force("charge")
                if (charge) {
                  charge.strength(-120)
                  charge.distanceMax(300)
                }
                const link = fg.d3Force("link")
                if (link) {
                  link.distance(50)
                }
              }}
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
