import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DownloadIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { LogView, type LogLine } from "@/components/blocks/log-view"
import { useConfirm } from "@/components/blocks/confirm"
import { notify } from "@/components/blocks/notify"
import { Toolbar, Page, Panel } from "@/components/blocks/surfaces"
import { EmptyState, ErrorState } from "@/components/blocks/state-boundary"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { clearActivityLogs, listActivityLogs } from "@/lib/api"
import type { ActivityLog } from "@/types"

const LEVELS = ["all", "debug", "info", "warn", "error"]
const CATEGORIES = ["all", "system", "ingest", "review", "document", "provider", "mcp", "acp", "api"]

function toLine(log: ActivityLog): LogLine {
  const detail = log.details ? safeParse(log.details) : undefined
  return {
    id: String(log.id),
    time: log.created_at,
    level: log.level as LogLine["level"],
    text: `[${log.category}] ${log.message || log.action}`,
    detail: detail ?? { action: log.action, resource: `${log.resource_type}:${log.resource_id}`, source: log.source, status: log.status },
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function LogsPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [level, setLevel] = React.useState("all")
  const [category, setCategory] = React.useState("all")
  const [limit, setLimit] = React.useState(200)

  const logs = useQuery({
    queryKey: ["activity-logs", category, level, limit],
    queryFn: () => listActivityLogs({
      limit,
      offset: 0,
      ...(category !== "all" ? { category } : {}),
      ...(level !== "all" ? { level } : {}),
    }),
    refetchInterval: 15_000,
  })

  const clear = useMutation({
    mutationFn: clearActivityLogs,
    onSuccess: async (result) => {
      notify.success(`已清空 ${result.deleted_count} 条日志`)
      await queryClient.invalidateQueries({ queryKey: ["activity-logs"] })
    },
    onError: (error) => notify.error(error, "清空失败"),
  })

  const lines = React.useMemo(() => (logs.data?.logs ?? []).map(toLine), [logs.data])

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs.data?.logs ?? [], null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `llmwiki-activity-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Page
      title="活动日志"
      actions={[
        { label: "刷新", icon: <RefreshCwIcon />, onSelect: () => void logs.refetch() },
        { label: "导出", icon: <DownloadIcon />, onSelect: exportLogs },
        {
          label: "清空日志",
          icon: <Trash2Icon />,
          destructive: true,
          onSelect: () => void (async () => {
            const ok = await confirm({
              title: "清空全部活动日志？",
              description: "该操作不可撤销。",
              confirmLabel: "清空",
              destructive: true,
            })
            if (ok) clear.mutate()
          })(),
        },
      ]}
    >
      <Toolbar>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger size="sm" aria-label="按分类筛选"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item === "all" ? "全部分类" : item}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger size="sm" aria-label="按级别筛选"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LEVELS.map((item) => <SelectItem key={item} value={item}>{item === "all" ? "全部级别" : item}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setLimit((value) => Math.min(value + 200, 500))} disabled={limit >= 500}>
          加载更多
        </Button>
      </Toolbar>

      <Panel padding="none">
        {logs.isError ? <ErrorState error={logs.error} onRetry={() => void logs.refetch()} /> : null}
        {!logs.isError && lines.length === 0 && !logs.isLoading ? <EmptyState title="暂无活动日志" description="系统操作与摄入任务会记录在这里。" /> : null}
        <LogView lines={lines} height="calc(100vh - 13rem)" follow={false} filterPlaceholder="过滤日志" className="llmwiki-logs [&_input]:max-sm:max-w-40" />
      </Panel>
    </Page>
  )
}
