import { useCallback, useEffect, useState } from "react"
import { PageContainer } from "@/components/PageContainer"
import { Button } from "@/components/ui/button"
import {
  clearActivityLogs,
  listActivityLogs,
  type ActivityLogListResponse,
} from "@/lib/api"
import type { ActivityLog } from "@/types"
import { cn } from "@/lib/utils"
import { useT } from "@/i18n"

const CATEGORIES = [
  "all",
  "ingest",
  "document",
  "vcs",
  "provider",
  "session",
  "system",
  "mcp",
  "watcher",
] as const

const LEVELS = ["all", "debug", "info", "warn", "error"] as const

function levelClass(level: string) {
  switch (level) {
    case "error":
      return "text-destructive"
    case "warn":
      return "text-amber-600 dark:text-amber-400"
    default:
      return "text-foreground"
  }
}

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: ActivityLog
  expanded: boolean
  onToggle: () => void
}) {
  const t = useT()
  const hasDetails = Boolean(log.details?.trim())
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs text-muted-foreground">{log.created_at}</span>
        <span className={cn("text-xs font-medium uppercase", levelClass(log.level))}>
          {log.level}
        </span>
        <span className="text-xs text-muted-foreground">{log.category}</span>
        <span className="flex-1 min-w-0">{log.message}</span>
        {hasDetails && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onToggle}
          >
            {expanded ? t("common.collapse") : t("common.details")}
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/50 p-2 text-xs">
          {formatDetails(log.details)}
        </pre>
      )}
    </div>
  )
}

function formatDetails(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function LogsPage() {
  const t = useT()
  const [category, setCategory] = useState<string>("all")
  const [level, setLevel] = useState<string>("all")
  const [limit, setLimit] = useState(50)
  const [data, setData] = useState<ActivityLogListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listActivityLogs({
        limit,
        offset: 0,
        category: category === "all" ? undefined : category,
        level: level === "all" ? undefined : level,
      })
      setData(res)
    } finally {
      setLoading(false)
    }
  }, [category, level, limit])

  useEffect(() => {
    void fetchLogs()
    const timer = setInterval(() => {
      void fetchLogs()
    }, 3000)
    return () => clearInterval(timer)
  }, [fetchLogs])

  const handleClear = async () => {
    setClearing(true)
    try {
      await clearActivityLogs()
      setConfirmClear(false)
      await fetchLogs()
    } finally {
      setClearing(false)
    }
  }

  const logs = data?.logs ?? []

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t("logs.filter_category")}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? t("logs.all_categories") : c}
                </option>
              ))}
            </select>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              aria-label={t("logs.filter_level")}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l === "all" ? t("logs.all_levels") : l}
                </option>
              ))}
            </select>
            {loading && (
              <span className="text-xs text-muted-foreground">{t("logs.refreshing")}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <span className="text-sm text-muted-foreground">
                  {t("logs.clear_confirm")}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={clearing}
                  onClick={() => void handleClear()}
                >
                  {t("logs.confirm_clear")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmClear(false)}
                >
                  {t("common.cancel")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmClear(true)}
              >
                {t("logs.clear_all")}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {logs.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("logs.empty")}
            </p>
          )}
          {logs.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              expanded={expandedId === log.id}
              onToggle={() =>
                setExpandedId((id) => (id === log.id ? null : log.id))
              }
            />
          ))}
        </div>

        {data?.has_more && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLimit((n) => n + 50)}
            >
              {t("logs.load_more")}
            </Button>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
