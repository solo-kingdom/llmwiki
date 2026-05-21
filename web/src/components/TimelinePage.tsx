import { useEffect, useState, useCallback } from "react"
import { PageContainer } from "@/components/PageContainer"
import { Button } from "@/components/ui/button"
import { getVCStatus, getVCLog, getVCDiff, createRollback } from "@/lib/api"
import type { VCStatus, VCLogEntry } from "@/types"
import { GitBranch, Clock, FileText, RotateCcw, Eye, ChevronDown, Settings, AlertTriangle } from "lucide-react"
import { navigateTo, workbenchViewHref } from "@/lib/wiki-routes"
import { CommitDiffDialog, DIFF_LOAD_FAILED_MARKER } from "@/components/CommitDiffDialog"
import { formatGitCommitTimestamp } from "@/lib/format-timestamp"
import { useT } from "@/i18n"

export function TimelinePage() {
  const t = useT()
  const [status, setStatus] = useState<VCStatus | null>(null)
  const [entries, setEntries] = useState<VCLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(50)
  const [hasMore, setHasMore] = useState(false)

  const [diffEntry, setDiffEntry] = useState<{ sha: string; diff: string; loading: boolean } | null>(null)

  const [rollbackEntry, setRollbackEntry] = useState<VCLogEntry | null>(null)
  const [rollbackLoading, setRollbackLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [s, log] = await Promise.all([getVCStatus(), getVCLog(limit)])
      setStatus(s)
      setEntries(log)
      setHasMore(log.length >= limit)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const loadMore = () => {
    setLimit((prev) => prev + 50)
  }

  const handleViewDiff = async (sha: string) => {
    setDiffEntry({ sha, diff: "", loading: true })
    try {
      const result = await getVCDiff(sha)
      setDiffEntry((prev) =>
        prev?.sha !== sha ? prev : { sha, diff: result.diff, loading: false },
      )
    } catch {
      setDiffEntry((prev) =>
        prev?.sha !== sha
          ? prev
          : { sha, diff: DIFF_LOAD_FAILED_MARKER, loading: false },
      )
    }
  }

  const handleRollback = async () => {
    if (!rollbackEntry) return
    setRollbackLoading(true)
    try {
      await createRollback(rollbackEntry.sha)
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

  if (!status?.enabled) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <GitBranch className="size-12 text-muted-foreground" />
          <p className="text-muted-foreground">{t("timeline.disabled")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateTo(workbenchViewHref("settings"))}
          >
            <Settings className="size-3.5 mr-1" />
            {t("timeline.go_settings")}
          </Button>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <GitBranch className="size-5" />
          {t("timeline.title")}
        </h1>
        <span className="text-sm text-muted-foreground">
          {t("timeline.commits", { count: status.commit_count })}
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
              key={entry.sha}
              className="border rounded-lg p-3 space-y-2 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {entry.subject}
                    </span>
                    {entry.is_rollback && (
                      <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                        {t("timeline.rollback_badge")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="font-mono">{entry.sha}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatGitCommitTimestamp(entry.timestamp)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="size-3" />
                      {t("timeline.files_changed", { count: entry.files_changed })}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => handleViewDiff(entry.sha)}
                  >
                    <Eye className="size-3.5 mr-1" />
                    {t("timeline.diff")}
                  </Button>
                  {!entry.is_rollback && (
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
              <Button variant="outline" size="sm" onClick={loadMore}>
                <ChevronDown className="size-3.5 mr-1" />
                {t("timeline.load_more")}
              </Button>
            </div>
          )}
        </div>
      )}

      <CommitDiffDialog
        key={diffEntry?.sha ?? "closed"}
        open={diffEntry !== null}
        sha={diffEntry?.sha ?? ""}
        diff={diffEntry?.diff ?? ""}
        loading={diffEntry?.loading ?? false}
        onClose={() => setDiffEntry(null)}
      />

      {rollbackEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRollbackEntry(null)}>
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
                {rollbackEntry.sha}: {rollbackEntry.subject}
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
                onClick={handleRollback}
                disabled={rollbackLoading}
              >
                {rollbackLoading ? t("timeline.rolling_back") : t("timeline.confirm_rollback")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
