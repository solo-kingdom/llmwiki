import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, RotateCcwIcon } from "lucide-react"
import { DataTable, useLimitPaging } from "@/components/blocks/data-table"
import { Id, Num, Time } from "@/components/blocks/format"
import { StatusBadge } from "@/components/blocks/status-badge"
import { CodeBlock } from "@/components/blocks/code-block"
import { Markdown } from "@/components/blocks/markdown"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/blocks/state-boundary"
import { Inline, Page, Panel, Properties, Row, Rows, ScrollRegion, Section, Stack } from "@/components/blocks/surfaces"
import { Button } from "@/components/ui/button"
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
import type { ChangeSet } from "@/types"

const columns: ColumnDef<ChangeSet, unknown>[] = [
  {
    accessorKey: "summary",
    header: "变更",
    meta: { kind: "primary" },
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate">{row.original.summary}</div>
        <div className="text-xs text-muted-foreground">{row.original.kind} · {row.original.page_count} 页</div>
      </div>
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
            {detail.data?.change_set.kind} · {detail.data?.change_set.created_at}
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
                提交反馈
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
  const { limit, paging } = useLimitPaging(50, 200)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const history = useQuery({ queryKey: ["history", limit], queryFn: () => listHistory(limit) })
  const changes = history.data?.changes ?? []

  return (
    <Page title="时间线">
      {history.isError ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : null}
      {!history.isError && history.isLoading ? <RowsSkeleton rows={5} /> : null}
      {!history.isError && !history.isLoading && changes.length === 0 ? <EmptyState title="暂无变更" /> : null}
      {!history.isError && changes.length > 0 ? (
        <DataTable
          label="变更时间线"
          columns={columns}
          data={changes}
          getRowId={(item) => item.id}
          selectedId={selectedId ?? undefined}
          onSelect={(item) => setSelectedId(item.id)}
          paging={paging(changes.length, history.isLoading)}
        />
      ) : null}
      <Section title="待审批的归档评审" description="评审通过后才会写入 wiki 页面。">
        <ReviewsSection />
      </Section>
      <ChangeSetSheet id={selectedId} open={selectedId !== null} onOpenChange={(open) => { if (!open) setSelectedId(null) }} />
    </Page>
  )
}
