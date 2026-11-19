import { useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SearchIcon } from "lucide-react"
import { notify } from "@/components/blocks/notify"
import { DataTable } from "@/components/blocks/data-table"
import { Id, Num, Time } from "@/components/blocks/format"
import { StatusBadge } from "@/components/blocks/status-badge"
import { Inline, Page, Panel, Properties, Row, Rows, Stack, Toolbar } from "@/components/blocks/surfaces"
import { AppLink } from "@/components/blocks/router"
import { EmptyState } from "@/components/blocks/state-boundary"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cancelIngestJob, getIngestJob, getIngestJobEvents, listIngestJobs, retryIngestJob } from "@/lib/api"
import type { IngestJob } from "@/types"

const columns: ColumnDef<IngestJob, unknown>[] = [
  { accessorKey: "source_path", header: "来源", meta: { kind: "primary" }, cell: ({ getValue }) => <span className="truncate">{getValue<string>() || "—"}</span> },
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
                <Button size="sm" variant="outline" disabled={!running && job.status !== "failed" || retry.isPending} onClick={() => retry.mutate()}>重试</Button>
                <Button size="sm" variant="ghost" disabled={!running || cancel.isPending} onClick={() => cancel.mutate()}>取消</Button>
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

export function JobsPage() {
  const [selectedId, setSelectedId] = useState("")
  const [search, setSearch] = useState("")
  const jobsQuery = useQuery({
    queryKey: ["ingest-jobs"],
    queryFn: () => listIngestJobs(50),
    refetchInterval: (query) => {
      const jobs = query.state.data ?? []
      return jobs.some((job) => job.status === "running" || job.status === "queued") ? 3000 : false
    },
  })
  const rows = useMemo(() => {
    const jobs = jobsQuery.data ?? []
    const needle = search.trim().toLowerCase()
    if (needle === "") return jobs
    return jobs.filter((job) =>
      job.id.toLowerCase().includes(needle)
      || job.source_path.toLowerCase().includes(needle)
      || job.source_ref.toLowerCase().includes(needle),
    )
  }, [jobsQuery.data, search])

  return (
    <Page
      title="摄入任务"
      actions={[{ label: "刷新", onSelect: () => { void jobsQuery.refetch() } }]}
    >
      <Toolbar>
        <InputGroup>
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            aria-label="搜索任务"
            placeholder="搜索来源或 Job ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
      </Toolbar>
      {jobsQuery.error !== null ? <p className="text-sm text-destructive">{jobsQuery.error.message}</p> : null}
      {!jobsQuery.isLoading && rows.length === 0 ? (
        <EmptyState
          title={search.trim() === "" ? "还没有摄入任务" : "没有匹配的任务"}
          description={search.trim() === "" ? "从对话或文本创建摄入后，任务会显示在这里。" : `没有匹配“${search}”的来源或 Job ID。`}
          action={search.trim() === "" ? <Button variant="outline" asChild><AppLink to="/">去创建摄入</AppLink></Button> : undefined}
        />
      ) : (
        <DataTable
          label="摄入任务"
          columns={columns}
          data={rows}
          getRowId={(job) => job.id}
          onSelect={(job) => setSelectedId(job.id)}
          selectedId={selectedId === "" ? undefined : selectedId}
          paging="complete"
        />
      )}
      {selectedId !== "" ? <JobDetail jobId={selectedId} onClose={() => setSelectedId("")} /> : null}
    </Page>
  )
}
