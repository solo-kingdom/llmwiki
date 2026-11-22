import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { InfoIcon, RotateCcwIcon } from "lucide-react"
import { AppLink } from "@/components/blocks/router"
import { Body, Inline, NavItem, NavList, Page, Panel, Properties, Split, Stack, Toolbar } from "@/components/blocks/surfaces"
import { StatusBadge } from "@/components/blocks/status-badge"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Num } from "@/components/blocks/format"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useContainerWidth } from "@/components/blocks/use-container-width"
import { getKnowledgeGraph } from "@/lib/api"

const WIDE = { width: 800, height: 520 }
const NARROW = { width: 360, height: 620 }

function labelWidth(text: string): number {
  const glyphs = Array.from(text).reduce((sum, char) => sum + (/[　-鿿]/.test(char) ? 10 : 6), 0)
  return Math.max(28, glyphs + 8)
}

function nodeRadius(canvas: { width: number }, linkCount: number): number {
  return canvas.width < 560
    ? 12 + Math.min(4, Math.max(0, linkCount))
    : 16 + Math.min(10, Math.max(0, linkCount))
}

function usePositions(nodes: { id: string }[], canvas: { width: number; height: number }) {
  return React.useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>()
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    if (canvas.width < 560) {
      const cols = 5
      const rows = Math.max(1, Math.ceil(nodes.length / cols))
      const cellWidth = canvas.width / cols
      const cellHeight = canvas.height / rows
      nodes.forEach((node, index) => {
        const col = index % cols
        const row = Math.floor(index / cols)
        positions.set(node.id, {
          x: cellWidth * (col + 0.5),
          y: cellHeight * (row + 0.5),
        })
      })
      return positions
    }
    const minSide = Math.min(canvas.width, canvas.height)
    const rings = nodes.length > 8
      ? [0, 1, 2].map((index) => ({
          nodes: nodes.slice(Math.floor((nodes.length * index) / 3), Math.floor((nodes.length * (index + 1)) / 3)),
          radius: minSide * (0.22 + index * 0.1),
        }))
      : [
          { nodes: nodes.slice(0, Math.ceil(nodes.length / 2)), radius: minSide * 0.26 },
          { nodes: nodes.slice(Math.ceil(nodes.length / 2)), radius: minSide * 0.42 },
        ]
    for (const ring of rings) {
      ring.nodes.forEach((node, index) => {
        const angle = (index / Math.max(1, ring.nodes.length)) * Math.PI * 2 - Math.PI / 2
        positions.set(node.id, {
          x: centerX + Math.cos(angle) * ring.radius,
          y: centerY + Math.sin(angle) * ring.radius,
        })
      })
    }
    return positions
  }, [nodes, canvas])
}

export function GraphPage() {
  const [limit, setLimit] = React.useState("200")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [hostRef, hostWidth] = useContainerWidth<HTMLDivElement>()
  const canvas = hostWidth > 0 && hostWidth < 560 ? NARROW : WIDE
  const graph = useQuery({
    queryKey: ["knowledge-graph", limit],
    queryFn: () => getKnowledgeGraph({ limit: Number.parseInt(limit, 10) }),
  })
  const nodes = React.useMemo(() => graph.data?.nodes ?? [], [graph.data?.nodes])
  const edges = graph.data?.edges ?? []
  const positions = usePositions(nodes, canvas)
  const selected = nodes.find((node) => node.id === selectedId)
  const hovered = nodes.find((node) => node.id === hoveredId)
  const hoveredPoint = hovered === undefined ? undefined : positions.get(hovered.id)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const labelLayout = React.useMemo(() => {
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
    const layout = new Map<string, { x: number; y: number; text: string; width: number }>()
    for (const node of nodes) {
      const point = positions.get(node.id)
      if (point === undefined) continue
      const radius = nodeRadius(canvas, node.link_count)
      placed.push({ x1: point.x - radius, y1: point.y - radius, x2: point.x + radius, y2: point.y + radius })
    }
    const budget = canvas.width < 560 ? 4 : 10
    const candidates = [...nodes].sort((a, b) => b.link_count - a.link_count).slice(0, budget)
    for (const node of candidates) {
      const point = positions.get(node.id)
      if (point === undefined) continue
      const radius = nodeRadius(canvas, node.link_count)
      const raw = node.title || node.id
      const text = raw.length > 12 ? `${raw.slice(0, 12)}…` : raw
      const width = labelWidth(text)
      const options = [
        { x: point.x, y: point.y + radius + 14 },
        { x: point.x, y: point.y - radius - 8 },
        { x: point.x + radius + width / 2 + 6, y: point.y + 4 },
        { x: point.x - radius - width / 2 - 6, y: point.y + 4 },
      ]
      for (const option of options) {
        const box = {
          x1: option.x - width / 2 - 2,
          y1: option.y - 10,
          x2: option.x + width / 2 + 2,
          y2: option.y + 4,
        }
        if (box.x1 < 0 || box.x2 > canvas.width || box.y1 < 0 || box.y2 > canvas.height) continue
        if (placed.some((p) => !(box.x2 < p.x1 || box.x1 > p.x2 || box.y2 < p.y1 || box.y1 > p.y2))) continue
        placed.push(box)
        layout.set(node.id, { ...option, text, width })
        break
      }
    }
    return layout
  }, [nodes, positions, canvas])

  const detailDialog = (
    <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{selected?.title || selected?.id || "节点详情"}</DialogTitle>
          <DialogDescription>节点详情</DialogDescription>
        </DialogHeader>
        {selected !== undefined ? (
          <Stack gap="md">
            <Properties
              columns={1}
              items={[
                { label: "类型", value: <StatusBadge status={selected.type} /> },
                { label: "引用数", value: <Num value={selected.link_count} /> },
                { label: "路径", value: selected.id, mono: true, wide: true },
              ]}
            />
            <Inline>
              <AppLink to={`/wiki/${encodeURIComponent(selected.document_id)}`} className="inline-flex min-h-6 items-center text-sm text-brand underline underline-offset-2">
                打开页面
              </AppLink>
            </Inline>
          </Stack>
        ) : null}
      </DialogContent>
    </Dialog>
  )

  return (
    <Page
      title="知识图谱"
      layout="fill"
      actions={[
        { label: "刷新", icon: <RotateCcwIcon />, iconOnly: true, onSelect: () => void graph.refetch() },
        ...(selected === undefined ? [] : [{ label: "节点详情", icon: <InfoIcon />, iconOnly: true, onSelect: () => setDetailOpen(true) }]),
      ]}
    >
      <Split
        sideLabel="图谱节点"
        sideWidth="md"
        side={
          <Stack gap="sm">
            <Toolbar end={<span className="text-xs text-muted-foreground">{nodes.length}</span>}>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger size="sm" aria-label="节点上限"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">最多 50 个节点</SelectItem>
                  <SelectItem value="100">最多 100 个节点</SelectItem>
                  <SelectItem value="200">最多 200 个节点</SelectItem>
                  <SelectItem value="500">最多 500 个节点</SelectItem>
                </SelectContent>
              </Select>
            </Toolbar>
            {graph.isLoading ? <RowsSkeleton rows={6} /> : null}
            {graph.isError ? <ErrorState error={graph.error} onRetry={() => void graph.refetch()} /> : null}
            {!graph.isLoading && !graph.isError && nodes.length === 0 ? <EmptyState title="暂无图谱数据" /> : null}
            <NavList label="图谱节点">
              {nodes.map((node) => (
                <NavItem
                  key={node.id}
                  active={selected?.id === node.id}
                  onSelect={() => setSelectedId(node.id)}
                  trailing={<Num value={node.link_count} />}
                >
                  {node.title || node.id}
                </NavItem>
              ))}
            </NavList>
          </Stack>
        }
      >
        <Body width="full" gap="md">
          <div ref={hostRef} className="relative min-w-0">
            {nodes.length === 0 ? <EmptyState title="暂无可视化节点" /> : (
              <svg viewBox={`0 0 ${canvas.width} ${canvas.height}`} width="100%" height="100%" role="img" aria-label="知识图谱">
                {edges.map((edge) => {
                  const from = positions.get(edge.source)
                  const to = positions.get(edge.target)
                  if (from === undefined || to === undefined) return null
                  return (
                    <line
                      key={`${edge.source}-${edge.target}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="currentColor"
                      strokeOpacity={selected && (edge.source === selected.id || edge.target === selected.id) ? 0.6 : 0.28}
                      strokeWidth={selected && (edge.source === selected.id || edge.target === selected.id) ? 2 : 1}
                    />
                  )
                })}
                {nodes.map((node) => {
                  const point = positions.get(node.id)
                  if (point === undefined) return null
                  const active = selected?.id === node.id
                  const radius = nodeRadius(canvas, node.link_count)
                  return (
                    <g
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={node.title || node.id}
                      onClick={() => setSelectedId(node.id)}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onFocus={() => setHoveredId(node.id)}
                      onBlur={() => setHoveredId(null)}
                    >
                      <title>{node.title || node.id}</title>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={active ? radius + 5 : radius}
                        fill="var(--card)"
                        stroke="currentColor"
                        strokeOpacity={active ? 0.95 : 0.5}
                        strokeWidth={active ? 2 : 1}
                      />
                    </g>
                  )
                })}
                {nodes.map((node) => {
                  const point = positions.get(node.id)
                  if (point === undefined) return null
                  const active = selected?.id === node.id
                  const placed = labelLayout.get(node.id)
                  if (placed === undefined && hoveredId !== node.id && !active) return null
                  const radius = nodeRadius(canvas, node.link_count)
                  const label = node.title || node.id
                  const labelText = placed?.text ?? (label.length > 12 ? `${label.slice(0, 12)}…` : label)
                  const labelWidthValue = placed?.width ?? labelWidth(labelText)
                  const labelX = placed?.x ?? point.x
                  const labelY = placed?.y ?? Math.min(canvas.height - 6, point.y + radius + 14)
                  return (
                    <g key={`label-${node.id}`} style={{ pointerEvents: "none" }}>
                      <rect
                        x={labelX - labelWidthValue / 2}
                        y={labelY - 10}
                        width={labelWidthValue}
                        height={13}
                        rx={3}
                        fill="var(--card)"
                        fillOpacity={0.94}
                      />
                      <text
                        x={labelX}
                        y={labelY}
                        textAnchor="middle"
                        fontSize="10"
                        fill="currentColor"
                      >
                        {labelText}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )}
            {hovered !== undefined && hoveredPoint !== undefined ? (
              <div className="pointer-events-none absolute z-10 max-w-xs"
                style={{
                  left: `${(hoveredPoint.x / canvas.width) * 100}%`,
                  top: `${(hoveredPoint.y / canvas.height) * 100}%`,
                  transform: `translate(${hoveredPoint.x > canvas.width * 0.62 ? "calc(-100% - 12px)" : "12px"}, ${hoveredPoint.y > canvas.height * 0.7 ? "calc(-100% - 12px)" : "12px"})`,
                }}>
                <Panel padding="md" title={hovered.title || hovered.id}>
                  <Inline gap="sm">
                    <StatusBadge status={hovered.type} />
                    <Num value={hovered.link_count} />
                    <span className="text-xs text-muted-foreground">引用</span>
                  </Inline>
                </Panel>
              </div>
            ) : null}
          </div>

          {detailDialog}
        </Body>
      </Split>
    </Page>
  )
}
