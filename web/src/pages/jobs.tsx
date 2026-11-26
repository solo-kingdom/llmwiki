import { useEffect, useState, type ReactNode } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FileUpIcon,
  GlobeIcon,
  ListIcon,
  Loader2Icon,
  MessageSquareIcon,
  RotateCcwIcon,
  SearchIcon,
  XCircleIcon,
} from "lucide-react"
import { notify } from "@/components/blocks/notify"
import { DataTable } from "@/components/blocks/data-table"
import { Id, Num, Time } from "@/components/blocks/format"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Inline, Page, Panel, Properties, Row, Rows, Stack, Toolbar } from "@/components/blocks/surfaces"
import { AppLink } from "@/components/blocks/router"
import { EmptyState } from "@/components/blocks/state-boundary"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cancelIngestJob, getIngestJob, getIngestJobEvents, listIngestJobs, retryIngestJob } from "@/lib/api"
import type { IngestJob, IngestJobStatusCounts } from "@/types"
import { cn } from "cn"

const PAGE_SIZE = 50

const EMPTY_COUNTS: IngestJobStatusCounts = {
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
}

type StatusFilter = "" | "queued,running" | "succeeded" | "failed" | "cancelled"

const INPUT_TYPES = [
  { value: "all", label: "全部类型" },
  { value: "text", label: "文本" },
  { value: "upload", label: "上传" },
  { value: "file", label: "文件" },
  { value: "conversation", label: "对话" },
  { value: "session_archive", label: "会话归档" },
  { value: "review_plan", label: "审阅计划" },
  { value: "review_apply", label: "审阅应用" },
  { value: "rollback", label: "回滚" },
] as const

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function JobSourceIcon({ inputType }: { inputType: string }) {
  const kind = inputType.toLowerCase()
  if (kind === "url" || kind === "web") {
    return <span className="llmwiki-icon-chip llmwiki-icon-chip--sky" aria-hidden="true"><GlobeIcon /></span>
  }
  if (kind === "file" || kind === "upload") {
    return <span className="llmwiki-icon-chip llmwiki-icon-chip--emerald" aria-hidden="true"><FileUpIcon /></span>
  }
  if (kind === "session" || kind === "chat") {
    return <span className="llmwiki-icon-chip llmwiki-icon-chip--violet" aria-hidden="true"><MessageSquareIcon /></span>
  }
  return <span className="llmwiki-icon-chip llmwiki-icon-chip--amber" aria-hidden="true"><FileTextIcon /></span>
}

const columns: ColumnDef<IngestJob, unknown>[] = [
  {
    accessorKey: "source_path",
    header: "来源",
    meta: { kind: "primary" },
    cell: ({ row }) => (
      <span className="llmwiki-cell-lead">
        <JobSourceIcon inputType={row.original.input_type} />
        <span className="truncate">{row.original.source_path || "—"}</span>
      </span>
    ),
  },
  { accessorKey: "status", header: "状态", meta: { kind: "status" }, cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  { accessorKey: "id", header: "Job", meta: { kind: "id", priority: 3 }, cell: ({ getValue }) => <Id value={getValue<string>()} /> },
  { accessorKey: "input_type", header: "类型", meta: { kind: "text", priority: 2 } },
  { accessorKey: "retries", header: "重试", meta: { kind: "number", priority: 2 }, cell: ({ getValue }) => <Num value={getValue<number>()} /> },
  { accessorKey: "updated_at", header: "更新于", meta: { kind: "time" }, cell: ({ getValue }) => <Time value={getValue<string>()} /> },
]

function JobDetail({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const jobQuery = useQuery({ queryKey: ["ingest-job", jobId], queryFn: () => getIngestJob(jobId) })
  const eventsQuery = useQuery({
    queryKey: ["ingest-job-events", jobId],
    queryFn: () => getIngestJobEvents(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.events === undefined ? "" : jobQuery.data?.job.status
      return status === "running" || status === "queued" ? 2000 : false
    },
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["ingest-jobs"] })
    void queryClient.invalidateQueries({ queryKey: ["ingest-job", jobId] })
    void queryClient.invalidateQueries({ queryKey: ["ingest-job-events", jobId] })
  }

  const retry = useMutation({
    mutationFn: () => retryIngestJob(jobId),
    onSuccess: () => { notify.success("已重新排队"); invalidate() },
    onError: (error: Error) => notify.error(error),
  })
  const cancel = useMutation({
    mutationFn: () => cancelIngestJob(jobId),
    onSuccess: () => { notify.success("已取消"); invalidate() },
    onError: (error: Error) => notify.error(error),
  })

  const job = jobQuery.data?.job
  const events = eventsQuery.data?.events ?? []
  const running = job?.status === "running" || job?.status === "queued"

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>任务详情</SheetTitle>
          <SheetDescription>{job?.source_path ?? jobId}</SheetDescription>
        </SheetHeader>
        <Stack gap="md">
          {jobQuery.error !== null ? <p className="text-sm text-destructive">{jobQuery.error.message}</p> : null}
          {job !== undefined ? (
            <>
              <Properties
                items={[
                  { label: "状态", value: <StatusBadge status={job.status} /> },
                  { label: "Job ID", value: job.id, mono: true },
                  { label: "来源", value: job.source_path || "—", mono: true },
                  { label: "类型", value: job.input_type },
                  { label: "重试", value: `${job.retries} / ${job.max_retries}` },
                  job.error_message !== "" ? { label: "错误", value: job.error_message } : null,
                  job.result_summary !== "" ? { label: "结果", value: job.result_summary } : null,
                  { label: "创建", value: <Time value={job.created_at} mode="datetime" /> },
                  { label: "更新", value: <Time value={job.updated_at} mode="datetime" /> },
                ]}
              />
              <Inline gap="sm">
                <Button size="sm" variant="outline" disabled={!running && job.status !== "failed" || retry.isPending} onClick={() => retry.mutate()}>
                  <RotateCcwIcon />重试
                </Button>
                <Button size="sm" variant="ghost" disabled={!running || cancel.isPending} onClick={() => cancel.mutate()}>
                  <XCircleIcon />取消
                </Button>
              </Inline>
              <Panel title="事件" padding="none">
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无事件。</p>
                ) : (
                  <Rows label="任务事件">
                    {events.map((event) => (
                      <Row key={event.id}>
                        <Stack gap="xs">
                          <span className="text-xs text-muted-foreground">
                            <Inline gap="sm">
                              <Time value={event.created_at} mode="datetime" />
                              <span>{event.step}</span>
                              <span>·</span>
                              <span>{event.phase}</span>
                            </Inline>
                          </span>
                          <span className="text-sm">{event.message}</span>
                        </Stack>
                      </Row>
                    ))}
                  </Rows>
                )}
              </Panel>
            </>
          ) : jobQuery.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
        </Stack>
      </SheetContent>
    </Sheet>
  )
}

function StatusFilterButton({
  label,
  count,
  tone,
  pressed,
  onClick,
  children,
}: {
  label: string
  count: number
  tone: "muted" | "sky" | "emerald" | "rose" | "amber"
  pressed: boolean
  onClick: () => void
  children: ReactNode
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

export function JobsPage() {
  const [selectedId, setSelectedId] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("")
  const [inputType, setInputType] = useState("all")
  const [page, setPage] = useState(1)
  const debounced = useDebounced(search.trim(), 300)
  const filterKey = `${status}\0${inputType}\0${debounced}`
  const [pageFilter, setPageFilter] = useState(filterKey)
  if (pageFilter !== filterKey) {
    setPageFilter(filterKey)
    setPage(1)
  }
  const effectivePage = pageFilter === filterKey ? page : 1

  const jobsQuery = useQuery({
    queryKey: ["ingest-jobs", status, inputType, debounced, effectivePage],
    queryFn: () => listIngestJobs({
      limit: PAGE_SIZE,
      offset: (effectivePage - 1) * PAGE_SIZE,
      ...(status !== "" ? { status } : {}),
      ...(inputType !== "all" ? { inputType } : {}),
      ...(debounced !== "" ? { q: debounced } : {}),
    }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const counts = query.state.data?.counts
      if (counts === undefined) return false
      return counts.queued + counts.running > 0 ? 3000 : false
    },
  })

  const counts = jobsQuery.data?.counts ?? EMPTY_COUNTS
  const jobs = jobsQuery.data?.jobs ?? []
  const total = jobsQuery.data?.total ?? 0
  const knownTotal = counts.queued + counts.running + counts.succeeded + counts.failed + counts.cancelled
  const activeCount = counts.queued + counts.running
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (
    jobsQuery.data !== undefined
    && !jobsQuery.isPlaceholderData
    && pageFilter === filterKey
    && effectivePage > lastPage
  ) {
    setPage(lastPage)
  }

  const chooseStatus = (next: StatusFilter) => {
    setStatus((current) => (current === next ? "" : next))
  }

  return (
    <Page
      title="摄入任务"
      actions={[{ label: "刷新", icon: <RotateCcwIcon />, iconOnly: true, onSelect: () => { void jobsQuery.refetch() } }]}
    >
      <Toolbar
        end={
          jobsQuery.data !== undefined ? (
            <span className="llmwiki-stat-pills" role="group" aria-label="按状态筛选">
              <StatusFilterButton label="全部" count={knownTotal} tone="muted" pressed={status === ""} onClick={() => setStatus("")}>
                <ListIcon aria-hidden="true" />
              </StatusFilterButton>
              <StatusFilterButton label="运行中" count={activeCount} tone="sky" pressed={status === "queued,running"} onClick={() => chooseStatus("queued,running")}>
                <Loader2Icon className={counts.running > 0 ? "animate-spin" : undefined} aria-hidden="true" />
              </StatusFilterButton>
              <StatusFilterButton label="成功" count={counts.succeeded} tone="emerald" pressed={status === "succeeded"} onClick={() => chooseStatus("succeeded")}>
                <CheckCircle2Icon aria-hidden="true" />
              </StatusFilterButton>
              <StatusFilterButton label="失败" count={counts.failed} tone="rose" pressed={status === "failed"} onClick={() => chooseStatus("failed")}>
                <XCircleIcon aria-hidden="true" />
              </StatusFilterButton>
              <StatusFilterButton label="已取消" count={counts.cancelled} tone="amber" pressed={status === "cancelled"} onClick={() => chooseStatus("cancelled")}>
                <BanIcon aria-hidden="true" />
              </StatusFilterButton>
            </span>
          ) : undefined
        }
      >
        <InputGroup className="max-w-sm">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            aria-label="搜索任务"
            placeholder="搜索来源或 Job ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <Select value={inputType} onValueChange={setInputType}>
          <SelectTrigger size="sm" aria-label="按类型筛选"><SelectValue /></SelectTrigger>
          <SelectContent>
            {INPUT_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Toolbar>
      {jobsQuery.error !== null ? <p className="text-sm text-destructive">{jobsQuery.error.message}</p> : null}
      {jobsQuery.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {jobsQuery.error === null && !jobsQuery.isLoading && jobs.length === 0 ? (
        <EmptyState
          title={knownTotal === 0 ? "还没有摄入任务" : "没有匹配的任务"}
          description={knownTotal === 0 ? "从对话或文本创建摄入后，任务会显示在这里。" : "没有符合当前状态、类型或关键词的任务。"}
          action={knownTotal === 0 ? <Button variant="outline" asChild><AppLink to="/">去创建摄入</AppLink></Button> : undefined}
        />
      ) : null}
      {jobs.length > 0 ? (
        <DataTable
          label="摄入任务"
          columns={columns}
          data={jobs}
          getRowId={(job) => job.id}
          onSelect={(job) => setSelectedId(job.id)}
          selectedId={selectedId === "" ? undefined : selectedId}
          paging={{
            mode: "pages",
            page: effectivePage,
            pageSize: PAGE_SIZE,
            total,
            onPage: setPage,
            loading: jobsQuery.isFetching,
          }}
        />
      ) : null}
      {selectedId !== "" ? <JobDetail jobId={selectedId} onClose={() => setSelectedId("")} /> : null}
    </Page>
  )
}
