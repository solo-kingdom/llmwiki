import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { RefreshCwIcon, RotateCcwIcon, ShieldAlertIcon } from "lucide-react"
import { DataTable } from "@/components/blocks/data-table"
import { Time } from "@/components/blocks/format"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Actions, Grid, Inline, Panel, Properties, Row, Rows, Section, Stack, Toolbar } from "@/components/blocks/surfaces"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getApiStatsApiKeyDetail,
  getApiStatsApiKeys,
  getApiStatsErrors,
  getApiStatsOverview,
  getApiStatsRoutes,
} from "@/lib/api"
import type {
  ApiAuthType,
  ApiStatsApiKeyItem,
  ApiStatsErrorItem,
  ApiStatsQuery,
  ApiStatsRange,
  ApiStatsRouteItem,
  ApiStatsRouteSort,
  ApiStatsSeriesPoint,
  ApiStatsStatusClass,
} from "@/types"

const RANGE_OPTIONS: Array<{ value: ApiStatsRange; label: string }> = [
  { value: "1h", label: "1 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
]

const AUTH_LABELS: Record<ApiAuthType, string> = {
  session: "会话",
  api_key: "API Key",
  anonymous: "匿名",
  invalid_key: "无效 Key",
}

function formatBucketLabel(iso: string, bucket: "minute" | "hour" | "day"): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  if (bucket === "day") {
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  }
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

const routeColumns: ColumnDef<ApiStatsRouteItem, unknown>[] = [
  {
    id: "route",
    header: "接口",
    meta: { kind: "primary" },
    cell: ({ row }) => (
      <span className="font-mono text-xs">{`${row.original.method} ${row.original.route_template}`}</span>
    ),
  },
  {
    id: "count",
    header: "调用量",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.count}</span>,
  },
  {
    id: "errors",
    header: "4xx / 5xx",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{`${row.original.error_4xx} / ${row.original.error_5xx}`}</span>,
  },
  {
    id: "error_rate",
    header: "错误率",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{`${row.original.error_rate}%`}</span>,
  },
  {
    id: "latency",
    header: "P95 / P99",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{`${row.original.p95_ms} / ${row.original.p99_ms} ms`}</span>,
  },
]

const errorColumns: ColumnDef<ApiStatsErrorItem, unknown>[] = [
  {
    id: "occurred_at",
    header: "时间",
    meta: { kind: "time" },
    cell: ({ row }) => <Time value={row.original.occurred_at} mode="datetime" />,
  },
  {
    id: "route",
    header: "接口",
    meta: { kind: "primary" },
    cell: ({ row }) => (
      <span className="font-mono text-xs">{`${row.original.method} ${row.original.route_template}`}</span>
    ),
  },
  {
    id: "status_code",
    header: "状态",
    meta: { kind: "status" },
    cell: ({ row }) => <Badge variant="destructive">{row.original.status_code}</Badge>,
  },
  {
    id: "source",
    header: "来源",
    meta: { kind: "text" },
    cell: ({ row }) => (
      <span className="text-xs">
        {row.original.api_key_prefix
          ? `${AUTH_LABELS[row.original.auth_type]} (${row.original.api_key_prefix})`
          : AUTH_LABELS[row.original.auth_type]}
      </span>
    ),
  },
  {
    id: "error_code",
    header: "错误码",
    meta: { kind: "id" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.error_code ?? "—"}</span>,
  },
  {
    id: "duration_ms",
    header: "耗时",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums text-xs">{`${row.original.duration_ms}ms`}</span>,
  },
]

const apiKeyColumns: ColumnDef<ApiStatsApiKeyItem, unknown>[] = [
  {
    id: "name",
    header: "名称 / 前缀",
    meta: { kind: "primary" },
    cell: ({ row }) => (
      <div>
        <div className="text-sm font-medium">{row.original.api_key_name || "未命名 Key"}</div>
        <div className="font-mono text-xs text-muted-foreground">{`${row.original.api_key_prefix}…`}</div>
      </div>
    ),
  },
  {
    id: "status",
    header: "状态",
    meta: { kind: "status" },
    cell: ({ row }) => <StatusBadge status={row.original.status === "active" ? "ready" : "warning"} />,
  },
  {
    id: "count",
    header: "调用量",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.count}</span>,
  },
  {
    id: "share_pct",
    header: "占比",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{`${row.original.share_pct}%`}</span>,
  },
  {
    id: "errors",
    header: "4xx / 5xx",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{`${row.original.error_4xx} / ${row.original.error_5xx}`}</span>,
  },
  {
    id: "p95_ms",
    header: "P95",
    meta: { kind: "number" },
    cell: ({ row }) => <span className="tabular-nums">{`${row.original.p95_ms}ms`}</span>,
  },
  {
    id: "last_seen_at",
    header: "最近活跃",
    meta: { kind: "time" },
    cell: ({ row }) => <Time value={row.original.last_seen_at} mode="relative" />,
  },
]

export function ApiStatsTrendChart({
  series,
  bucket,
}: {
  series: ApiStatsSeriesPoint[]
  bucket: "minute" | "hour" | "day"
}) {
  if (series.length === 0) {
    return <EmptyState title="暂无趋势数据" description="当前时间范围和筛选条件下还没有请求记录。" />
  }

  const width = 640
  const height = 160
  const padX = 24
  const padY = 16
  const chartW = width - padX * 2
  const chartH = height - padY * 2
  const maxReq = Math.max(1, ...series.map((s) => s.requests))
  const maxP95 = Math.max(1, ...series.map((s) => s.p95_ms))
  const step = chartW / Math.max(1, series.length)
  const barW = Math.max(4, Math.min(24, step * 0.6))

  const p95Points = series
    .map((pt, i) => {
      const x = padX + i * step + step / 2
      const y = padY + chartH - (pt.p95_ms / maxP95) * chartH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return (
    <Stack gap="sm">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="请求量与延迟趋势图">
        <line x1={padX} y1={padY + chartH} x2={width - padX} y2={padY + chartH} stroke="currentColor" strokeOpacity={0.15} />
        {series.map((pt, i) => {
          const x = padX + i * step + (step - barW) / 2
          const totalH = (pt.requests / maxReq) * chartH
          const errCount = pt.error_4xx + pt.error_5xx
          const errH = (errCount / maxReq) * chartH
          const okH = Math.max(0, totalH - errH)
          const okY = padY + chartH - totalH
          const errY = padY + chartH - errH
          return (
            <g key={pt.bucket_start}>
              <title>
                {`${formatBucketLabel(pt.bucket_start, bucket)} · 请求 ${pt.requests} · 4xx ${pt.error_4xx} · 5xx ${pt.error_5xx} · P95 ${pt.p95_ms}ms`}
              </title>
              {okH > 0 && (
                <rect
                  x={x}
                  y={okY}
                  width={barW}
                  height={okH}
                  rx={2}
                  fill="var(--primary)"
                  fillOpacity={0.75}
                />
              )}
              {errH > 0 && (
                <rect
                  x={x}
                  y={errY}
                  width={barW}
                  height={errH}
                  rx={2}
                  fill="var(--destructive)"
                  fillOpacity={0.85}
                />
              )}
            </g>
          )
        })}
        {series.length > 1 && (
          <polyline
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity={0.65}
            strokeWidth={1.5}
            points={p95Points}
          />
        )}
      </svg>
      <Inline gap="sm" wrap>
        <span className="text-xs text-muted-foreground">柱高：请求总量（峰值 {maxReq}）</span>
        <span className="text-xs text-destructive">红段：4xx / 5xx 错误</span>
        <span className="text-xs text-muted-foreground">折线：P95 延迟（峰值 {maxP95}ms）</span>
      </Inline>
    </Stack>
  )
}

function KeyDetailSheet({
  keyId,
  query,
  onClose,
}: {
  keyId: string | null
  query: ApiStatsQuery
  onClose: () => void
}) {
  const detailQuery = useQuery({
    queryKey: ["api-stats", "key-detail", keyId, query],
    queryFn: () => getApiStatsApiKeyDetail(keyId!, query),
    enabled: Boolean(keyId),
  })

  const detail = detailQuery.data

  return (
    <Sheet open={Boolean(keyId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {detail ? `${detail.key.api_key_name || detail.key.api_key_id}` : "API Key 详情"}
          </SheetTitle>
          <SheetDescription>
            {detail ? (
              <Inline gap="sm">
                <span className="font-mono">{detail.key.api_key_prefix}</span>
                <StatusBadge
                  status={
                    detail.key.status === "active"
                      ? "ready"
                      : detail.key.status === "revoked"
                        ? "warning"
                        : "failed"
                  }
                />
              </Inline>
            ) : (
              "加载 API Key 访问下钻统计"
            )}
          </SheetDescription>
        </SheetHeader>

        {detailQuery.isLoading ? (
          <RowsSkeleton rows={5} />
        ) : detailQuery.error ? (
          <ErrorState error={detailQuery.error as Error} onRetry={() => void detailQuery.refetch()} />
        ) : detail ? (
          <Stack gap="md">
            <Panel title="用量摘要">
              <Properties
                columns={2}
                items={[
                  { label: "总请求数", value: detail.key.total_requests },
                  { label: "P95 延迟", value: `${detail.key.p95_ms} ms` },
                  { label: "4xx 错误", value: detail.key.error_4xx },
                  { label: "5xx 错误", value: detail.key.error_5xx },
                  {
                    label: "最近活跃",
                    value: <Time value={detail.key.last_seen_at} mode="datetime" />,
                    wide: true,
                  },
                ]}
              />
            </Panel>

            <Panel title="调用趋势">
              <ApiStatsTrendChart
                series={detail.series}
                bucket={query.range === "1h" ? "minute" : query.range === "7d" || query.range === "30d" ? "day" : "hour"}
              />
            </Panel>

            <Panel title="高频路由" padding="none">
              {detail.top_routes.length === 0 ? (
                <EmptyState title="暂无路由记录" />
              ) : (
                <DataTable
                  label="单 Key 高频路由"
                  columns={routeColumns}
                  data={detail.top_routes}
                  getRowId={(r) => `${r.method}-${r.route_template}`}
                  paging="complete"
                  frame="flush"
                />
              )}
            </Panel>

            <Panel title="最近错误" padding="none">
              {detail.recent_errors.length === 0 ? (
                <EmptyState title="暂无错误" description="当前窗口内无 >=400 响应。" />
              ) : (
                <DataTable
                  label="单 Key 最近错误"
                  columns={errorColumns}
                  data={detail.recent_errors}
                  getRowId={(r) => String(r.id)}
                  paging="complete"
                  frame="flush"
                />
              )}
            </Panel>
          </Stack>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function ApiStatsSection() {
  const [tab, setTab] = React.useState<"overview" | "api-keys">("overview")
  const [range, setRange] = React.useState<ApiStatsRange>("24h")
  const [method, setMethod] = React.useState<string>("")
  const [route, setRoute] = React.useState<string>("")
  const [statusClass, setStatusClass] = React.useState<string>("")
  const [authType, setAuthType] = React.useState<string>("")
  const [routeSort, setRouteSort] = React.useState<ApiStatsRouteSort>("count")
  const [selectedKeyId, setSelectedKeyId] = React.useState<string | null>(null)

  const query: ApiStatsQuery = React.useMemo(() => {
    const q: ApiStatsQuery = { range }
    if (method) q.method = method
    if (route.trim()) q.route = route.trim()
    if (statusClass) q.status_class = statusClass as ApiStatsStatusClass
    if (authType) q.auth_type = authType as ApiAuthType
    return q
  }, [range, method, route, statusClass, authType])

  const overviewQuery = useQuery({
    queryKey: ["api-stats", "overview", query],
    queryFn: () => getApiStatsOverview(query),
  })

  const routesQuery = useQuery({
    queryKey: ["api-stats", "routes", query, routeSort],
    queryFn: () => getApiStatsRoutes(query, { sort: routeSort, limit: 50 }),
    enabled: tab === "overview",
  })

  const errorsQuery = useQuery({
    queryKey: ["api-stats", "errors", query],
    queryFn: () => getApiStatsErrors(query, 50),
    enabled: tab === "overview",
  })

  const apiKeysQuery = useQuery({
    queryKey: ["api-stats", "api-keys", query],
    queryFn: () => getApiStatsApiKeys(query),
    enabled: tab === "api-keys",
  })

  function resetFilters() {
    setMethod("")
    setRoute("")
    setStatusClass("")
    setAuthType("")
  }

  function refreshAll() {
    void overviewQuery.refetch()
    if (tab === "overview") {
      void routesQuery.refetch()
      void errorsQuery.refetch()
    } else {
      void apiKeysQuery.refetch()
    }
  }

  const hasFilters = Boolean(method || route.trim() || statusClass || authType)
  const overview = overviewQuery.data
  const keysData = apiKeysQuery.data

  return (
    <Section
      size="lg"
      gap="lg"
      title="接口统计"
      description="观测 HTTP 接口调用量、延迟分位、错误分布与 API Key 用量及 401/403 安全边界。"
      actions={
        <Actions>
          <Button size="sm" variant="outline" onClick={refreshAll}>
            <RefreshCwIcon />刷新
          </Button>
        </Actions>
      }
    >
      <Stack gap="md">
        <Panel>
          <Stack gap="sm">
            <Toolbar
              end={
                <Inline gap="xs">
                  {hasFilters && (
                    <Button size="sm" variant="ghost" onClick={resetFilters}>
                      <RotateCcwIcon />重置筛选
                    </Button>
                  )}
                </Inline>
              }
            >
              <Inline gap="xs" wrap>
                {RANGE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={range === opt.value ? "default" : "outline"}
                    onClick={() => setRange(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </Inline>
            </Toolbar>

            <Grid columns={3} gap="sm">
              <Select value={method || "ALL"} onValueChange={(v) => setMethod(v === "ALL" ? "" : v)}>
                <SelectTrigger aria-label="HTTP 方法筛选">
                  <SelectValue placeholder="全部方法" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部方法</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusClass || "ALL"} onValueChange={(v) => setStatusClass(v === "ALL" ? "" : v)}>
                <SelectTrigger aria-label="状态码段筛选">
                  <SelectValue placeholder="全部状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部状态</SelectItem>
                  <SelectItem value="2xx">2xx 成功</SelectItem>
                  <SelectItem value="3xx">3xx 重定向</SelectItem>
                  <SelectItem value="4xx">4xx 客户端错误</SelectItem>
                  <SelectItem value="5xx">5xx 服务端错误</SelectItem>
                </SelectContent>
              </Select>

              <Select value={authType || "ALL"} onValueChange={(v) => setAuthType(v === "ALL" ? "" : v)}>
                <SelectTrigger aria-label="鉴权来源筛选">
                  <SelectValue placeholder="全部来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部来源</SelectItem>
                  <SelectItem value="session">会话</SelectItem>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="anonymous">匿名</SelectItem>
                  <SelectItem value="invalid_key">无效 Key</SelectItem>
                </SelectContent>
              </Select>
            </Grid>

            <Input
              aria-label="按路由模板筛选"
              placeholder="按路由模板过滤，例如 /api/v1/documents/:id 或 /_unmatched"
              value={route}
              onChange={(e) => setRoute(e.target.value)}
            />
          </Stack>
        </Panel>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "api-keys")}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="api-keys">API Key 专项</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Stack gap="md">
              {overviewQuery.isLoading ? (
                <RowsSkeleton rows={6} />
              ) : overviewQuery.error ? (
                <ErrorState error={overviewQuery.error as Error} onRetry={() => void overviewQuery.refetch()} />
              ) : overview ? (
                <>
                  <Grid columns={3} gap="md">
                    <Panel title="总请求量">
                      <Properties
                        items={[
                          { label: "请求数", value: overview.summary.total_requests },
                          { label: "RPS", value: overview.summary.rps },
                          { label: "活跃路由", value: overview.summary.active_routes },
                        ]}
                      />
                    </Panel>
                    <Panel title="成功率与错误率">
                      <Properties
                        items={[
                          { label: "成功率", value: `${overview.summary.success_rate}%` },
                          { label: "4xx 错误率", value: `${overview.summary.error_4xx_rate}%` },
                          { label: "5xx 错误率", value: `${overview.summary.error_5xx_rate}%` },
                        ]}
                      />
                    </Panel>
                    <Panel title="延迟分位">
                      <Properties
                        items={[
                          { label: "平均 / P50", value: `${overview.summary.avg_duration_ms} / ${overview.summary.p50_ms} ms` },
                          { label: "P95", value: `${overview.summary.p95_ms} ms` },
                          { label: "P99", value: `${overview.summary.p99_ms} ms` },
                        ]}
                      />
                    </Panel>
                  </Grid>

                  <Panel title="请求量与错误趋势">
                    <ApiStatsTrendChart series={overview.series} bucket={overview.range.bucket} />
                  </Panel>

                  <Grid columns={2} gap="md">
                    <Panel title="状态码分布" padding="none">
                      {overview.status_distribution.length === 0 ? (
                        <EmptyState title="暂无状态分布" />
                      ) : (
                        <Rows label="状态码分布">
                          {overview.status_distribution.map((item) => (
                            <Row key={item.status_class}>
                              <span className="font-mono text-sm">{item.status_class}</span>
                              <span className="tabular-nums text-sm font-medium">{item.count}</span>
                            </Row>
                          ))}
                        </Rows>
                      )}
                    </Panel>
                    <Panel title="调用来源拆分" padding="none">
                      {overview.auth_sources.length === 0 ? (
                        <EmptyState title="暂无来源分布" />
                      ) : (
                        <Rows label="调用来源">
                          {overview.auth_sources.map((item) => (
                            <Row key={item.auth_type}>
                              <span className="text-sm">{AUTH_LABELS[item.auth_type] ?? item.auth_type}</span>
                              <span className="tabular-nums text-sm font-medium">{item.count}</span>
                            </Row>
                          ))}
                        </Rows>
                      )}
                    </Panel>
                  </Grid>
                </>
              ) : null}

              <Panel
                title="Top 接口排行"
                description="点击任意路由可快速按该路由模板筛选。"
                actions={
                  <Select value={routeSort} onValueChange={(v) => setRouteSort(v as ApiStatsRouteSort)}>
                    <SelectTrigger aria-label="路由排序方式">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="count">按调用量</SelectItem>
                      <SelectItem value="error_rate">按错误率</SelectItem>
                      <SelectItem value="p95">按 P95 延迟</SelectItem>
                    </SelectContent>
                  </Select>
                }
                padding="none"
              >
                {routesQuery.isLoading ? (
                  <RowsSkeleton rows={5} />
                ) : routesQuery.error ? (
                  <ErrorState error={routesQuery.error as Error} onRetry={() => void routesQuery.refetch()} />
                ) : !routesQuery.data || routesQuery.data.items.length === 0 ? (
                  <EmptyState title="暂无路由统计" />
                ) : (
                  <DataTable
                    label="Top 接口排行"
                    columns={routeColumns}
                    data={routesQuery.data.items}
                    getRowId={(r) => `${r.method}-${r.route_template}`}
                    onSelect={(r) => setRoute(r.route_template)}
                    paging="complete"
                    frame="flush"
                  />
                )}
              </Panel>

              <Panel title="最近错误明细" description="仅展示状态码 >= 400 的脱敏记录（不含请求体与明文凭据）。" padding="none">
                {errorsQuery.isLoading ? (
                  <RowsSkeleton rows={5} />
                ) : errorsQuery.error ? (
                  <ErrorState error={errorsQuery.error as Error} onRetry={() => void errorsQuery.refetch()} />
                ) : !errorsQuery.data || errorsQuery.data.items.length === 0 ? (
                  <EmptyState title="暂无错误记录" description="当前窗口内没有异常请求。" />
                ) : (
                  <DataTable
                    label="最近错误明细"
                    columns={errorColumns}
                    data={errorsQuery.data.items}
                    getRowId={(r) => String(r.id)}
                    paging="complete"
                    frame="flush"
                  />
                )}
              </Panel>
            </Stack>
          </TabsContent>

          <TabsContent value="api-keys">
            <Stack gap="md">
              {apiKeysQuery.isLoading ? (
                <RowsSkeleton rows={5} />
              ) : apiKeysQuery.error ? (
                <ErrorState error={apiKeysQuery.error as Error} onRetry={() => void apiKeysQuery.refetch()} />
              ) : keysData ? (
                <>
                  <Grid columns={2} gap="md">
                    <Panel title="API Key 调用概览">
                      <Properties
                        items={[
                          { label: "Key 总请求量", value: keysData.summary.total_key_requests },
                          { label: "活跃 Key 数", value: keysData.summary.active_key_count },
                        ]}
                      />
                    </Panel>
                    <Panel
                      title="异常鉴权边界"
                      actions={
                        <Button size="sm" variant="outline" onClick={() => setSelectedKeyId("__invalid__")}>
                          <ShieldAlertIcon />查看无效 Key 尝试
                        </Button>
                      }
                    >
                      <Properties
                        items={[
                          { label: "无效 Key 401 尝试", value: keysData.summary.unauthorized_401_count },
                          { label: "越权访问 403 拦截", value: keysData.summary.forbidden_403_count },
                        ]}
                      />
                    </Panel>
                  </Grid>

                  <Panel title="API Key 用量排行" description="包含已吊销 Key 的历史快照统计；点击行下钻查看单 Key 趋势与错误。" padding="none">
                    {keysData.items.length === 0 ? (
                      <EmptyState title="暂无 API Key 记录" description="创建或使用 API Key 后将在此显示统计。" />
                    ) : (
                      <DataTable
                        label="API Key 用量排行"
                        columns={apiKeyColumns}
                        data={keysData.items}
                        getRowId={(r) => r.api_key_id}
                        onSelect={(r) => setSelectedKeyId(r.api_key_id)}
                        paging="complete"
                        frame="flush"
                      />
                    )}
                  </Panel>
                </>
              ) : null}
            </Stack>
          </TabsContent>
        </Tabs>
      </Stack>

      <KeyDetailSheet keyId={selectedKeyId} query={query} onClose={() => setSelectedKeyId(null)} />
    </Section>
  )
}
