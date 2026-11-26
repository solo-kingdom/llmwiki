import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { CrosshairIcon, ExternalLinkIcon, InfoIcon, ListIcon, RotateCcwIcon, ScanIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react"
import { AppLink } from "@/components/blocks/router"
import { Inline, NavItem, NavList, Page, Properties, Split, Stack, Toolbar } from "@/components/blocks/surfaces"
import { StatusBadge } from "@/components/blocks/status-badge"
import { EmptyState, ErrorState } from "@/components/blocks/state-boundary"
import { Num } from "@/components/blocks/format"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ScrollRegion } from "@/components/blocks/surfaces"
import { useIsMobile } from "@/hooks/use-mobile"
import { getKnowledgeGraph } from "@/lib/api"
import type { GraphNode } from "@/types"
import { KnowledgeGraphCanvas, type KnowledgeGraphCanvasHandle } from "@/components/graph/knowledge-graph-canvas"
import { buildAdjacency, filterGraphNodes, getNeighborhood } from "@/components/graph/graph-model"

interface NodeBrowserProps {
  nodes: GraphNode[]
  totalNodes: number
  selectedId: string | null
  query: string
  limit: string
  onQueryChange: (value: string) => void
  onLimitChange: (value: string) => void
  onSelect: (nodeId: string) => void
}

function NodeBrowser({ nodes, totalNodes, selectedId, query, limit, onQueryChange, onLimitChange, onSelect }: NodeBrowserProps) {
  const filtered = React.useMemo(() => filterGraphNodes(nodes, query), [nodes, query])
  return (
    <Stack gap="sm">
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="搜索标题或路径"
        aria-label="搜索图谱节点"
      />
      <Toolbar end={<span className="text-xs text-muted-foreground"><Num value={filtered.length} /></span>}>
        <Select value={limit} onValueChange={onLimitChange}>
          <SelectTrigger size="sm" aria-label="节点上限"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="50">最多 50 个节点</SelectItem>
            <SelectItem value="100">最多 100 个节点</SelectItem>
            <SelectItem value="200">最多 200 个节点</SelectItem>
            <SelectItem value="500">最多 500 个节点</SelectItem>
          </SelectContent>
        </Select>
      </Toolbar>
      {filtered.length === 0 ? (
        <EmptyState title="没有匹配节点" description={nodes.length === 0 ? "暂无可视化节点" : "换一个标题或路径关键词"} />
      ) : (
        <NavList label="图谱节点">
          {filtered.map((node) => (
            <NavItem
              key={node.id}
              active={selectedId === node.id}
              onSelect={() => onSelect(node.id)}
              icon={<span
                className={`graph-node-type graph-node-type--${node.type === "page" || node.type === "entity" ? node.type : "concept"}`}
                title={`类型：${node.type}`}
                aria-label={`类型：${node.type}`}
              />}
              trailing={<Num value={node.link_count} />}
            >
              {node.title || node.id}
            </NavItem>
          ))}
        </NavList>
      )}
      <span className="text-xs text-muted-foreground">全库共 <Num value={totalNodes} /> 个节点</span>
    </Stack>
  )
}

export function GraphPage() {
  const [limit, setLimit] = React.useState("100")
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [focused, setFocused] = React.useState(false)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [listOpen, setListOpen] = React.useState(false)
  const canvasRef = React.useRef<KnowledgeGraphCanvasHandle>(null)
  const isMobile = useIsMobile()
  const graph = useQuery({
    queryKey: ["knowledge-graph", limit],
    queryFn: () => getKnowledgeGraph({ limit: Number.parseInt(limit, 10) }),
  })
  const nodes = React.useMemo(() => graph.data?.nodes ?? [], [graph.data?.nodes])
  const edges = React.useMemo(() => graph.data?.edges ?? [], [graph.data?.edges])
  const adjacency = React.useMemo(() => buildAdjacency(nodes, edges), [nodes, edges])
  const selected = nodes.find((node) => node.id === selectedId)
  const activeSelectedId = selected?.id ?? null
  const neighborhood = React.useMemo(() => getNeighborhood(adjacency, activeSelectedId), [adjacency, activeSelectedId])

  const selectFromBrowser = (nodeId: string) => {
    setSelectedId(nodeId)
    setListOpen(false)
    canvasRef.current?.centerOn(nodeId)
  }

  const browser = (
    <NodeBrowser
      nodes={nodes}
      totalNodes={graph.data?.total_nodes ?? nodes.length}
      selectedId={selectedId}
      query={query}
      limit={limit}
      onQueryChange={setQuery}
      onLimitChange={(value) => {
        setLimit(value)
        setSelectedId(null)
        setFocused(false)
      }}
      onSelect={selectFromBrowser}
    />
  )

  const detailDialog = (
    <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{selected?.title || selected?.id || "节点详情"}</DialogTitle>
          <DialogDescription>节点详情</DialogDescription>
        </DialogHeader>
        {selected ? (
          <Stack gap="md">
            <Properties
              columns={1}
              items={[
                { label: "类型", value: <StatusBadge status={selected.type} /> },
                { label: "引用数", value: <Num value={selected.link_count} /> },
                { label: "直接关联", value: <Num value={Math.max(0, neighborhood.size - 1)} /> },
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

  let stage: React.ReactNode
  if (graph.isLoading) {
    stage = <div className="graph-state" role="status"><Inline><Spinner /><span className="text-sm text-muted-foreground">正在加载知识星图…</span></Inline></div>
  } else if (graph.isError) {
    stage = <div className="graph-state"><ErrorState error={graph.error} onRetry={() => void graph.refetch()} /></div>
  } else if (nodes.length === 0) {
    stage = <div className="graph-state"><EmptyState title="暂无图谱数据" description="写入知识页面并建立引用后，这里会形成知识星图" /></div>
  } else {
    stage = (
      <div className="graph-stage">
        <KnowledgeGraphCanvas
          ref={canvasRef}
          nodes={nodes}
          edges={edges}
          selectedId={activeSelectedId}
          neighborhood={neighborhood}
          focused={focused && selected !== undefined}
          onSelect={setSelectedId}
        />
        <div className="graph-summary">
          {isMobile ? (
            <Button variant="ghost" size="sm" onClick={() => setListOpen(true)} aria-label="打开节点列表">
              <ListIcon />节点
            </Button>
          ) : null}
          <span aria-live="polite">
            {focused && selected ? <><Num value={neighborhood.size} /> 个关联节点</> : <><Num value={nodes.length} /> / <Num value={graph.data?.total_nodes ?? nodes.length} /> 节点</>}
          </span>
          {graph.data?.truncated && !(focused && selected) ? <span title="按关联数加载排名靠前的节点">已截断</span> : null}
        </div>
        {selected ? (
          <div className="graph-selection-actions">
            <Button variant="ghost" size="sm" onClick={() => setFocused((value) => !value)}>
              {focused ? <ScanIcon /> : <CrosshairIcon />}
              {focused ? "返回全局" : "聚焦邻域"}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <AppLink to={`/wiki/${encodeURIComponent(selected.document_id)}`}><ExternalLinkIcon />打开</AppLink>
            </Button>
          </div>
        ) : null}
        <div className="graph-legend" aria-label="节点类型图例">
          <span className="graph-legend-item"><span className="graph-legend-dot graph-legend-dot--page" />页面</span>
          <span className="graph-legend-item"><span className="graph-legend-dot graph-legend-dot--entity" />实体</span>
          <span className="graph-legend-item"><span className="graph-legend-dot graph-legend-dot--concept" />概念</span>
        </div>
        <div className="graph-controls" aria-label="图谱视图控制">
          <Button variant="ghost" size="icon-lg" onClick={() => canvasRef.current?.zoomIn()} aria-label="放大图谱" title="放大">
            <ZoomInIcon />
          </Button>
          <Button variant="ghost" size="icon-lg" onClick={() => canvasRef.current?.zoomOut()} aria-label="缩小图谱" title="缩小">
            <ZoomOutIcon />
          </Button>
          <Button variant="ghost" size="icon-lg" onClick={() => canvasRef.current?.reset()} aria-label="重居中图谱" title="重居中">
            <CrosshairIcon />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Page
      title="知识图谱"
      layout="fill"
      actions={[
        { label: "刷新", icon: <RotateCcwIcon />, iconOnly: true, onSelect: () => void graph.refetch() },
        ...(selected ? [{ label: "节点详情", icon: <InfoIcon />, iconOnly: true, onSelect: () => setDetailOpen(true) }] : []),
      ]}
    >
      {isMobile ? stage : (
        <Split sideLabel="图谱节点" sideWidth="md" side={browser}>
          {stage}
        </Split>
      )}
      {isMobile ? (
        <Sheet open={listOpen} onOpenChange={setListOpen}>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>图谱节点</SheetTitle>
              <SheetDescription>搜索并定位知识节点</SheetDescription>
            </SheetHeader>
            <div className="graph-sheet-body">
              <ScrollRegion name="graph-nodes" label="图谱节点列表">{browser}</ScrollRegion>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      {detailDialog}
    </Page>
  )
}
