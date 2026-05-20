import { useEffect, useState, useCallback } from "react"
import { PageContainer } from "@/components/PageContainer"
import { Button } from "@/components/ui/button"
import { getVCStatus, getVCLog, getVCDiff, createRollback } from "@/lib/api"
import type { VCStatus, VCLogEntry } from "@/types"
import { GitBranch, Clock, FileText, RotateCcw, Eye, ChevronDown, Settings, AlertTriangle } from "lucide-react"

export function TimelinePage() {
  const [status, setStatus] = useState<VCStatus | null>(null)
  const [entries, setEntries] = useState<VCLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(50)
  const [hasMore, setHasMore] = useState(false)

  // Diff modal state
  const [diffEntry, setDiffEntry] = useState<{ sha: string; diff: string; loading: boolean } | null>(null)

  // Rollback confirm state
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
      setDiffEntry({ sha, diff: result.diff, loading: false })
    } catch {
      setDiffEntry({ sha, diff: "Failed to load diff", loading: false })
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
          Loading timeline...
        </div>
      </PageContainer>
    )
  }

  if (!status?.enabled) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <GitBranch className="size-12 text-muted-foreground" />
          <p className="text-muted-foreground">Version control is not enabled.</p>
          <Button variant="outline" size="sm" onClick={() => {
            window.location.hash = "#settings"
            const event = new CustomEvent("navigate", { detail: "settings" })
            window.dispatchEvent(event)
          }}>
            <Settings className="size-3.5 mr-1" />
            Go to Settings
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
          Timeline
        </h1>
        <span className="text-sm text-muted-foreground">
          {status.commit_count} commit{status.commit_count !== 1 ? "s" : ""}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 space-y-2">
          <Clock className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">No history yet</p>
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
                        rollback
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="font-mono">{entry.sha}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="size-3" />
                      {entry.files_changed} file{entry.files_changed !== 1 ? "s" : ""}
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
                    Diff
                  </Button>
                  {!entry.is_rollback && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-amber-600 hover:text-amber-700"
                      onClick={() => setRollbackEntry(entry)}
                    >
                      <RotateCcw className="size-3.5 mr-1" />
                      Rollback
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
                Load More
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Diff Modal */}
      {diffEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDiffEntry(null)}>
          <div
            className="bg-background border rounded-lg shadow-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold text-sm">
                Diff: <span className="font-mono">{diffEntry.sha}</span>
              </h2>
              <Button size="sm" variant="ghost" onClick={() => setDiffEntry(null)}>
                ✕
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {diffEntry.loading ? (
                <p className="text-muted-foreground text-sm">Loading diff...</p>
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/50 p-3 rounded">
                  {diffEntry.diff || "(empty diff)"}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rollback Confirm Modal */}
      {rollbackEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRollbackEntry(null)}>
          <div
            className="bg-background border rounded-lg shadow-lg max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" />
              <h2 className="font-semibold">Confirm Rollback</h2>
            </div>
            <div className="text-sm space-y-2 text-muted-foreground">
              <p>This will roll back the changes from:</p>
              <p className="font-mono text-xs bg-muted p-2 rounded">
                {rollbackEntry.sha}: {rollbackEntry.subject}
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>The wiki changes from this ingest will be reversed via LLM</li>
                <li>Original source file will be moved to revert/ directory (if it still exists)</li>
                <li>This action creates a new rollback commit in the timeline</li>
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRollbackEntry(null)}
                disabled={rollbackLoading}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleRollback}
                disabled={rollbackLoading}
              >
                {rollbackLoading ? "Rolling back..." : "Confirm Rollback"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  )
}

function formatTimestamp(ts: string): string {
  if (!ts) return ""
  try {
    const date = new Date(ts.replace(" ", "T"))
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHr / 24)

    if (diffMin < 1) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    if (diffDay < 7) return `${diffDay}d ago`
    return date.toLocaleDateString()
  } catch {
    return ts
  }
}
