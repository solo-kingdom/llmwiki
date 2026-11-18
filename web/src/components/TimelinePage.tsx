import { useEffect, useState, useCallback } from "react"
import { PageContainer } from "@/components/PageContainer"
import { Button } from "@/components/ui/button"
import {
  listHistory,
  getHistory,
  getHistoryDiff,
  rollbackHistory,
} from "@/lib/api"
import type { ChangeSet, HistoryDetailResponse } from "@/types"
import {
  Clock,
  FileText,
  RotateCcw,
  Eye,
  Info,
  ChevronDown,
  AlertTriangle,
  History,
  Loader2,
} from "lucide-react"
import {
  HistoryDiffDialog,
  DIFF_LOAD_FAILED_MARKER,
} from "@/components/HistoryDiffDialog"
import { formatGitCommitTimestamp } from "@/lib/format-timestamp"
import { useT, type MessageKey } from "@/i18n"

const PAGE_SIZE = 50

const KIND_KEYS: Record<string, MessageKey> = {
  ingest: "timeline.kind.ingest",
  review_apply: "timeline.kind.review_apply",
  rollback: "timeline.kind.rollback",
  manual: "timeline.kind.manual",
  delete: "timeline.kind.delete",
  import: "timeline.kind.import",
}

const OPERATION_KEYS: Record<string, MessageKey> = {
  create: "timeline.operation.create",
  update: "timeline.operation.update",
  delete: "timeline.operation.delete",
  restore: "timeline.operation.restore",
}

export function TimelinePage() {
  const t = useT()
  const [entries, setEntries] = useState<ChangeSet[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const [diffEntry, setDiffEntry] = useState<{
    id: string
    diff: string
    loading: boolean
  } | null>(null)

  const [detailEntry, setDetailEntry] = useState<{
    id: string
    loading: boolean
    data: HistoryDetailResponse | null
    error: boolean
  } | null>(null)

  const [rollbackEntry, setRollbackEntry] = useState<ChangeSet | null>(null)
  const [rollbackLoading, setRollbackLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const resp = await listHistory(PAGE_SIZE)
      setEntries(resp.changes)
      setHasMore(resp.changes.length >= PAGE_SIZE)
    } catch {
      setEntries([])
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const loadMore = async () => {
    if (entries.length === 0 || loadingMore) return
    setLoadingMore(true)
    try {
      const resp = await listHistory(
        PAGE_SIZE,
        entries[entries.length - 1].created_at,
      )
      setEntries((prev) => {
        const seen = new Set(prev.map((entry) => entry.id))
        return [...prev, ...resp.changes.filter((entry) => !seen.has(entry.id))]
      })
      setHasMore(resp.changes.length >= PAGE_SIZE)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }

  const handleViewDiff = useCallback(async (id: string) => {
    setDiffEntry({ id, diff: "", loading: true })
    try {
      const result = await getHistoryDiff(id)
      setDiffEntry((prev) =>
        prev?.id !== id ? prev : { id, diff: result.diff, loading: false },
      )
    } catch {
      setDiffEntry((prev) =>
        prev?.id !== id
          ? prev
          : { id, diff: DIFF_LOAD_FAILED_MARKER, loading: false },
      )
    }
  }, [])

  const handleViewDetail = useCallback(async (id: string) => {
    setDetailEntry({ id, loading: true, data: null, error: false })
    try {
      const data = await getHistory(id)
      setDetailEntry((prev) =>
        prev?.id !== id ? prev : { id, loading: false, data, error: false },
      )
    } catch {
      setDetailEntry((prev) =>
        prev?.id !== id
          ? prev
          : { id, loading: false, data: null, error: true },
      )
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const change = params.get("change")?.trim()
    if (!change) return
    void handleViewDiff(change)
  }, [handleViewDiff])

  const handleRollback = async () => {
    if (!rollbackEntry) return
    setRollbackLoading(true)
    try {
      await rollbackHistory(rollbackEntry.id)
      setRollbackEntry(null)
      await loadData()
    } catch (err) {
      console.error("Rollback failed:", err)
    } finally {
      setRollbackLoading(false)
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          {t("timeline.loading")}
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <History className="size-5" />
          {t("timeline.title")}
        </h1>
        <span className="text-sm text-muted-foreground">
          {t("timeline.changes", { count: entries.length })}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 space-y-2">
          <Clock className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">{t("timeline.no_history")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="border rounded-lg p-3 space-y-2 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                      {KIND_KEYS[entry.kind] ? t(KIND_KEYS[entry.kind]) : entry.kind}
                    </span>
                    <span className="text-sm font-medium truncate">
                      {entry.summary || entry.id}
                    </span>
                    {entry.rollback_of && (
                      <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded shrink-0">
                        {t("timeline.rollback_badge")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="font-mono truncate">{entry.id}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatGitCommitTimestamp(entry.created_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="size-3" />
                      {t("timeline.pages_changed", { count: entry.page_count })}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => void handleViewDetail(entry.id)}
                  >
                    <Info className="size-3.5 mr-1" />
                    {t("timeline.details")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => void handleViewDiff(entry.id)}
                  >
                    <Eye className="size-3.5 mr-1" />
                    {t("timeline.diff")}
                  </Button>
                  {!entry.rollback_of && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-amber-600 hover:text-amber-700"
                      onClick={() => setRollbackEntry(entry)}
                    >
                      <RotateCcw className="size-3.5 mr-1" />
                      {t("timeline.rollback")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="size-3.5 mr-1 animate-spin" />
                ) : (
                  <ChevronDown className="size-3.5 mr-1" />
                )}
                {t("timeline.load_more")}
              </Button>
            </div>
          )}
        </div>
      )}

      <HistoryDiffDialog
        key={diffEntry?.id ?? "closed"}
        open={diffEntry !== null}
        changeId={diffEntry?.id ?? ""}
        diff={diffEntry?.diff ?? ""}
        loading={diffEntry?.loading ?? false}
        onClose={() => setDiffEntry(null)}
      />

      {detailEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDetailEntry(null)}
        >
          <div
            className="bg-background border rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 p-4 border-b shrink-0">
              <h2 className="font-semibold text-sm">
                {t("timeline.detail.title")}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDetailEntry(null)}
              >
                ✕
              </Button>
            </div>
            <div className="p-4 text-sm overflow-y-auto space-y-3">
              {detailEntry.loading ? (
                <p className="text-muted-foreground">
                  {t("timeline.detail.loading")}
                </p>
              ) : detailEntry.error || !detailEntry.data ? (
                <p className="text-destructive">{t("timeline.detail.failed")}</p>
              ) : (
                <>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      <span className="text-foreground">
                        {t("timeline.detail.kind")}:
                      </span>{" "}
                      {KIND_KEYS[detailEntry.data.change_set.kind]
                        ? t(KIND_KEYS[detailEntry.data.change_set.kind])
                        : detailEntry.data.change_set.kind}
                    </div>
                    {detailEntry.data.change_set.source_filename && (
                      <div>
                        <span className="text-foreground">
                          {t("timeline.detail.source")}:
                        </span>{" "}
                        {detailEntry.data.change_set.source_filename}
                      </div>
                    )}
                    <div>
                      <span className="text-foreground">
                        {t("timeline.detail.time")}:
                      </span>{" "}
                      {formatGitCommitTimestamp(
                        detailEntry.data.change_set.created_at,
                      )}
                    </div>
                  </div>
                  {detailEntry.data.pages.length === 0 ? (
                    <p className="text-muted-foreground">
                      {t("timeline.detail.no_pages")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detailEntry.data.pages.map((page) => (
                        <div
                          key={page.id}
                          className="border rounded-md px-3 py-2 space-y-1"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                              {OPERATION_KEYS[page.operation]
                                ? t(OPERATION_KEYS[page.operation])
                                : page.operation}
                            </span>
                            <span className="text-xs font-mono truncate">
                              {page.relative_path}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto shrink-0">
                              r{page.revision_no}
                            </span>
                          </div>
                          {page.title && (
                            <div className="text-sm truncate">{page.title}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {rollbackEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setRollbackEntry(null)}
        >
          <div
            className="bg-background border rounded-lg shadow-lg max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              <h2 className="font-semibold">{t("timeline.confirm_rollback")}</h2>
            </div>
            <div className="text-sm space-y-2 text-muted-foreground">
              <p>{t("timeline.rollback_intro")}</p>
              <p className="font-mono text-xs bg-muted p-2 rounded">
                {rollbackEntry.id}: {rollbackEntry.summary || rollbackEntry.kind}
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>{t("timeline.rollback_note_1")}</li>
                <li>{t("timeline.rollback_note_2")}</li>
                <li>{t("timeline.rollback_note_3")}</li>
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRollbackEntry(null)}
                disabled={rollbackLoading}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleRollback()}
                disabled={rollbackLoading}
              >
                {rollbackLoading
                  ? t("timeline.rolling_back")
                  : t("timeline.confirm_rollback")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
