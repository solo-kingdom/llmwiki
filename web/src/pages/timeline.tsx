import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  ClipboardCheckIcon,
  FileInputIcon,
  FilePenLineIcon,
  FilePlus2Icon,
  HistoryIcon,
  ListIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { cn } from "cn"
import { DataTable } from "@/components/blocks/data-table"
import { Id, Num, Time } from "@/components/blocks/format"
import { StatusBadge } from "@/components/blocks/status-badge"
import { CodeBlock } from "@/components/blocks/code-block"
import { Markdown } from "@/components/blocks/markdown"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Inline, Page, Panel, Properties, Row, Rows, ScrollRegion, Section, Stack, Toolbar } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  addIngestReviewFeedback,
  approveIngestReview,
  getHistory,
  getHistoryDiff,
  getIngestReview,
  listHistory,
  listIngestReviewPlans,
  listIngestReviews,
  replanIngestReview,
  rollbackHistory,
} from "@/lib/api"
import { resolveTimelineRange, type TimeRangePreset } from "@/lib/timeline-range"
import { statusEntry } from "@/lib/vocab"
import type { ChangeSet, ChangeSetKindCounts } from "@/types"

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const

const EMPTY_COUNTS: ChangeSetKindCounts = {
  ingest: 0,
  review_apply: 0,
  rollback: 0,
  manual: 0,
  delete: 0,
  import: 0,
}

type KindFilter = "" | "ingest" | "review_apply" | "manual" | "delete" | "rollback" | "import"

const TIME_PRESETS: readonly { value: TimeRangePreset; label: string }[] = [
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
  { value: "custom", label: "自定义日期" },
]

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function ChangeKindIcon({ kind }: { kind: string }) {
  if (kind === "ingest" || kind === "create") return <span className="llmwiki-icon-chip llmwiki-icon-chip--sky" aria-hidden="true"><SparklesIcon /></span>
  if (kind === "review_apply") return <span className="llmwiki-icon-chip llmwiki-icon-chip--emerald" aria-hidden="true"><FilePlus2Icon /></span>
  if (kind === "manual" || kind === "update") return <span className="llmwiki-icon-chip llmwiki-icon-chip--indigo" aria-hidden="true"><FilePenLineIcon /></span>
  if (kind === "delete") return <span className="llmwiki-icon-chip llmwiki-icon-chip--rose" aria-hidden="true"><Trash2Icon /></span>
  if (kind === "rollback" || kind === "restore") return <span className="llmwiki-icon-chip llmwiki-icon-chip--amber" aria-hidden="true"><RotateCcwIcon /></span>
  if (kind === "import") return <span className="llmwiki-icon-chip llmwiki-icon-chip--indigo" aria-hidden="true"><FileInputIcon /></span>
  return <span className="llmwiki-icon-chip llmwiki-icon-chip--indigo" aria-hidden="true"><HistoryIcon /></span>
}

function KindFilterButton({
  label,
  count,
  tone,
  pressed,
  onClick,
  children,
}: {
  label: string
  count: number
  tone: "muted" | "sky" | "emerald" | "rose" | "amber" | "indigo"
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cn("llmwiki-stat-pill", `llmwiki-stat-pill--${tone}`, pressed && "llmwiki-stat-pill--pressed")}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
      {label} {count}
    </button>
  )
}

const columns: ColumnDef<ChangeSet, unknown>[] = [
  {
    accessorKey: "summary",
    header: "变更",
    meta: { kind: "primary" },
    cell: ({ row }) => (
      <span className="llmwiki-cell-lead">
        <ChangeKindIcon kind={row.original.kind} />
        <div className="min-w-0">
          <div className="truncate">{row.original.summary}</div>
          <div className="text-xs text-muted-foreground">{statusEntry(row.original.kind).label} · {row.original.page_count} 页</div>
        </div>
      </span>
    ),
  },
  { accessorKey: "kind", header: "类型", meta: { kind: "status", priority: 2 }, cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  { accessorKey: "page_count", header: "页面", meta: { kind: "number", priority: 2 }, cell: ({ getValue }) => <Num value={getValue<number>()} /> },
  { accessorKey: "id", header: "Change set", meta: { kind: "id", priority: 3 }, cell: ({ getValue }) => <Id value={getValue<string>()} /> },
  { accessorKey: "created_at", header: "时间", meta: { kind: "time" }, cell: ({ getValue }) => <Time value={getValue<string>()} mode="datetime" /> },
]

function ChangeSetSheet({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const detail = useQuery({ queryKey: ["history", id], queryFn: () => getHistory(id ?? ""), enabled: id !== null })
  const diff = useQuery({ queryKey: ["history-diff", id], queryFn: () => getHistoryDiff(id ?? ""), enabled: id !== null })
  const rollback = useMutation({
    mutationFn: (changeSetId: string) => rollbackHistory(changeSetId),
    onSuccess: async () => {
      notify.success("回滚任务已创建")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["history"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["history-diff"] }),
      ])
      onOpenChange(false)
    },
    onError: (error) => notify.error(error, "回滚失败"),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{detail.data?.change_set.summary || "变更详情"}</SheetTitle>
          <SheetDescription>
            {detail.data ? (
              <Inline gap="xs">
                <StatusBadge status={detail.data.change_set.kind} />
                <Time value={detail.data.change_set.created_at} mode="datetime" />
              </Inline>
            ) : "加载变更详情…"}
          </SheetDescription>
        </SheetHeader>
        <ScrollRegion name="sheet" label="变更详情">
          {detail.isLoading ? <RowsSkeleton rows={6} /> : null}
          {detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : null}
          {detail.data ? (
            <Stack gap="lg">
              <Properties
                columns={2}
                items={[
                  { label: "类型", value: <StatusBadge status={detail.data.change_set.kind} /> },
                  { label: "页面", value: <Num value={detail.data.change_set.page_count} /> },
                  { label: "ID", value: <Id value={detail.data.change_set.id} /> },
                  { label: "来源", value: detail.data.change_set.source_filename || "—" },
                ]}
              />
              <Section title="页面">
                <Panel padding="none">
                  {detail.data.pages.length === 0 ? <EmptyState title="没有页面变更" /> : (
                    <Rows label="页面变更">
                      {detail.data.pages.map((page) => (
                        <Row key={page.id}>
                          <StatusBadge status={page.operation} />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{page.relative_path}</span>
                          <span className="text-xs text-muted-foreground">#{page.revision_no}</span>
                        </Row>
                      ))}
                    </Rows>
                  )}
                </Panel>
              </Section>
              <Section title="Diff">
                {diff.isLoading ? <RowsSkeleton rows={4} /> : null}
                {diff.isError ? <ErrorState error={diff.error} onRetry={() => void diff.refetch()} /> : null}
                {diff.data ? (
                  diff.data.diff.trim() === "" ? <EmptyState title="没有差异" /> : <CodeBlock code={diff.data.diff} language="diff" maxHeight="28rem" />
                ) : null}
              </Section>
              <Inline>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "回滚这次变更？",
                      description: "会创建一个新的回滚变更集，历史保留。",
                      confirmLabel: "回滚",
                      destructive: true,
                    })
                    if (ok && id) rollback.mutate(id)
                  }}
                  disabled={rollback.isPending}
                >
                  <RotateCcwIcon />回滚
                </Button>
              </Inline>
            </Stack>
          ) : null}
        </ScrollRegion>
      </SheetContent>
    </Sheet>
  )
}

function ReviewsSection() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState("")
  const reviews = useQuery({ queryKey: ["ingest-reviews"], queryFn: listIngestReviews })
  const selected = reviews.data?.find((review) => review.id === selectedId) ?? reviews.data?.[0]
  const detail = useQuery({ queryKey: ["ingest-review", selected?.id], queryFn: () => getIngestReview(selected?.id ?? ""), enabled: selected !== undefined })
  const plans = useQuery({ queryKey: ["ingest-review-plans", selected?.id], queryFn: () => listIngestReviewPlans(selected?.id ?? ""), enabled: selected !== undefined })
  const latestPlan = plans.data?.length
    ? [...plans.data].sort((left, right) => right.version - left.version)[0]
    : undefined

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ingest-reviews"] }),
      queryClient.invalidateQueries({ queryKey: ["ingest-review", selected?.id] }),
      queryClient.invalidateQueries({ queryKey: ["ingest-review-plans", selected?.id] }),
      queryClient.invalidateQueries({ queryKey: ["history"] }),
    ])
  }

  const sendFeedback = useMutation({
    mutationFn: () => addIngestReviewFeedback(selected?.id ?? "", feedback),
    onSuccess: async () => {
      notify.success("反馈已提交")
      setFeedback("")
      await refresh()
    },
    onError: (error) => notify.error(error, "提交失败"),
  })
  const replan = useMutation({
    mutationFn: () => replanIngestReview(selected?.id ?? ""),
    onSuccess: async () => {
      notify.success("已开始重新规划")
      await refresh()
    },
    onError: (error) => notify.error(error, "重新规划失败"),
  })
  const approve = useMutation({
    mutationFn: () => approveIngestReview(selected?.id ?? ""),
    onSuccess: async () => {
      notify.success("已批准并开始应用")
      await refresh()
    },
    onError: (error) => notify.error(error, "批准失败"),
  })

  if (reviews.isLoading) return <RowsSkeleton rows={4} />
  if (reviews.isError) return <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
  if ((reviews.data?.length ?? 0) === 0) {
    return (
      <Panel padding="none">
        <EmptyState title="暂无归档评审" description="会话归档后会先生成整理计划。" />
      </Panel>
    )
  }

  return (
    <Stack gap="md">
      <Panel padding="none">
        <Rows label="归档评审">
          {reviews.data?.map((review) => (
            <Row key={review.id}>
              <span className="llmwiki-icon-chip llmwiki-icon-chip--amber" aria-hidden="true"><ClipboardCheckIcon /></span>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm hover:text-brand"
                onClick={() => setSelectedId(review.id)}
              >
                {review.archive_source_path || review.id}
              </button>
              <StatusBadge status={review.status} />
              <Time value={review.updated_at} mode="datetime" />
            </Row>
          ))}
        </Rows>
      </Panel>

      {selected && detail.data ? (
        <Panel title="评审详情" actions={<StatusBadge status={detail.data.status} />}>
          <Stack gap="md">
            <Properties
              columns={2}
              items={[
                { label: "当前计划版本", value: <Num value={detail.data.current_plan_version} /> },
                { label: "已批准版本", value: <Num value={detail.data.approved_plan_version} /> },
                { label: "变更集", value: detail.data.change_set_id ? <Id value={detail.data.change_set_id} /> : "—" },
                { label: "会话", value: detail.data.session_id || "—" },
              ]}
            />
            <Section title={`整理计划 v${latestPlan?.version ?? 0}`}>
              {plans.isLoading ? <RowsSkeleton rows={4} /> : null}
              {latestPlan?.plan_markdown ? <Markdown>{latestPlan.plan_markdown}</Markdown> : <EmptyState title="暂无计划" />}
            </Section>
            <Textarea
              aria-label="评审反馈"
              placeholder="写下修改意见，例如：把行动项拆到独立的 query 页"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
            <Inline>
              <Button size="sm" onClick={() => sendFeedback.mutate()} disabled={feedback.trim() === "" || sendFeedback.isPending}>
                <SendIcon />提交反馈
              </Button>
              <Button size="sm" variant="outline" onClick={() => replan.mutate()} disabled={replan.isPending}>
                <RotateCcwIcon />重新规划
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const ok = await confirm({
                    title: "批准并应用该计划？",
                    description: "批准后会写入 wiki 页面并生成变更集。",
                    confirmLabel: "批准并应用",
                  })
                  if (ok) approve.mutate()
                }}
                disabled={approve.isPending}
              >
                <CheckIcon />批准并应用
              </Button>
            </Inline>
          </Stack>
        </Panel>
      ) : null}
    </Stack>
  )
}

export function TimelinePage() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [kind, setKind] = React.useState<KindFilter>("")
  const [timePreset, setTimePreset] = React.useState<TimeRangePreset>("all")
  const [customFrom, setCustomFrom] = React.useState("")
  const [customTo, setCustomTo] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)

  const debounced = useDebounced(search.trim(), 300)
  const timeRange = React.useMemo(
    () => resolveTimelineRange(timePreset, customFrom, customTo),
    [timePreset, customFrom, customTo],
  )

  const filterKey = `${kind}\0${debounced}\0${timePreset}\0${customFrom}\0${customTo}\0${pageSize}`
  const [pageFilter, setPageFilter] = React.useState(filterKey)
  if (pageFilter !== filterKey) {
    setPageFilter(filterKey)
    setPage(1)
  }
  const effectivePage = pageFilter === filterKey ? page : 1

  const history = useQuery({
    queryKey: ["history", kind, debounced, timeRange.from ?? "", timeRange.to ?? "", effectivePage, pageSize],
    queryFn: () => listHistory({
      limit: pageSize,
      offset: (effectivePage - 1) * pageSize,
      ...(kind !== "" ? { kind } : {}),
      ...(debounced !== "" ? { q: debounced } : {}),
      ...(timeRange.from ? { from: timeRange.from } : {}),
      ...(timeRange.to ? { to: timeRange.to } : {}),
    }),
    enabled: timeRange.invalid !== true,
    placeholderData: keepPreviousData,
  })

  const counts = history.data?.counts ?? EMPTY_COUNTS
  const changes = history.data?.changes ?? []
  const total = history.data?.total ?? 0
  const knownTotal = counts.ingest + counts.review_apply + counts.manual + counts.delete + counts.rollback + counts.import
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (
    history.data !== undefined
    && !history.isPlaceholderData
    && pageFilter === filterKey
    && effectivePage > lastPage
  ) {
    setPage(lastPage)
  }

  const hasActiveFilters = search.trim() !== "" || kind !== "" || timePreset !== "all"
  const clearFilters = () => {
    setSearch("")
    setKind("")
    setTimePreset("all")
    setCustomFrom("")
    setCustomTo("")
  }
  const chooseKind = (next: KindFilter) => {
    setKind((current) => (current === next ? "" : next))
  }

  return (
    <Page
      title="时间线"
      actions={[{ label: "刷新", icon: <RotateCcwIcon />, iconOnly: true, onSelect: () => void history.refetch() }]}
    >
      <Toolbar
        end={
          history.data !== undefined ? (
            <span className="llmwiki-stat-pills" role="group" aria-label="按变更类型筛选">
              <KindFilterButton label="全部" count={knownTotal} tone="muted" pressed={kind === ""} onClick={() => setKind("")}>
                <ListIcon aria-hidden="true" />
              </KindFilterButton>
              <KindFilterButton label="摄入" count={counts.ingest} tone="sky" pressed={kind === "ingest"} onClick={() => chooseKind("ingest")}>
                <SparklesIcon aria-hidden="true" />
              </KindFilterButton>
              <KindFilterButton label="评审应用" count={counts.review_apply} tone="emerald" pressed={kind === "review_apply"} onClick={() => chooseKind("review_apply")}>
                <FilePlus2Icon aria-hidden="true" />
              </KindFilterButton>
              <KindFilterButton label="手动" count={counts.manual} tone="indigo" pressed={kind === "manual"} onClick={() => chooseKind("manual")}>
                <FilePenLineIcon aria-hidden="true" />
              </KindFilterButton>
              <KindFilterButton label="删除" count={counts.delete} tone="rose" pressed={kind === "delete"} onClick={() => chooseKind("delete")}>
                <Trash2Icon aria-hidden="true" />
              </KindFilterButton>
              <KindFilterButton label="回滚" count={counts.rollback} tone="amber" pressed={kind === "rollback"} onClick={() => chooseKind("rollback")}>
                <RotateCcwIcon aria-hidden="true" />
              </KindFilterButton>
              {(counts.import > 0 || kind === "import") ? (
                <KindFilterButton label="导入" count={counts.import} tone="muted" pressed={kind === "import"} onClick={() => chooseKind("import")}>
                  <FileInputIcon aria-hidden="true" />
                </KindFilterButton>
              ) : null}
            </span>
          ) : undefined
        }
      >
        <InputGroup className="max-w-sm">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            aria-label="搜索变更"
            placeholder="搜索摘要、页面路径或 ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <Select value={timePreset} onValueChange={(value) => setTimePreset(value as TimeRangePreset)}>
          <SelectTrigger size="sm" aria-label="按时间周期筛选"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIME_PRESETS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {timePreset === "custom" ? (
          <Inline gap="xs">
            <Input
              type="date"
              aria-label="开始日期"
              className="h-8 w-36"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
            <span className="text-xs text-muted-foreground">至</span>
            <Input
              type="date"
              aria-label="结束日期"
              className="h-8 w-36"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </Inline>
        ) : null}
        {hasActiveFilters ? (
          <Button size="sm" variant="ghost" onClick={clearFilters}>清除筛选</Button>
        ) : null}
      </Toolbar>

      {timeRange.invalid ? <p className="text-sm text-destructive">开始日期不能晚于结束日期</p> : null}
      {history.isError ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : null}
      {!history.isError && !timeRange.invalid && history.isLoading ? <RowsSkeleton rows={5} /> : null}
      {!history.isError && !timeRange.invalid && !history.isLoading && changes.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? "没有匹配的变更" : "暂无变更"}
          description={hasActiveFilters ? "没有符合当前时间周期、类型或关键词的变更记录。" : undefined}
          action={hasActiveFilters ? <Button variant="outline" onClick={clearFilters}>清除筛选</Button> : undefined}
        />
      ) : null}
      {!history.isError && !timeRange.invalid && changes.length > 0 ? (
        <DataTable
          label="变更时间线"
          columns={columns}
          data={changes}
          getRowId={(item) => item.id}
          selectedId={selectedId ?? undefined}
          onSelect={(item) => setSelectedId(item.id)}
          paging={{
            mode: "pages",
            page: effectivePage,
            pageSize,
            total,
            onPage: setPage,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            onPageSize: (nextSize) => {
              setPageSize(nextSize)
              setPage(1)
            },
            loading: history.isFetching,
          }}
        />
      ) : null}
      <Section title="待审批的归档评审" description="评审通过后才会写入 wiki 页面。">
        <ReviewsSection />
      </Section>
      <ChangeSetSheet id={selectedId} open={selectedId !== null} onOpenChange={(open) => { if (!open) setSelectedId(null) }} />
    </Page>
  )
}
