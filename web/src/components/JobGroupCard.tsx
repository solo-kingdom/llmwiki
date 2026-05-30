import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n"
import type { IngestJob } from "@/types"
import { isPreviewable } from "@/components/SourcePreviewDialog"
import { activeJobOfGroup } from "@/lib/job-grouping"

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    succeeded: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    queued: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-600"
      }`}
    >
      {status}
    </span>
  )
}

function extractFileName(sourcePath: string): string {
  if (!sourcePath) return ""
  const parts = sourcePath.split("/")
  return parts[parts.length - 1] || sourcePath
}

export function JobGroupCard({
  jobs,
  onRetry,
  onCancel,
  onPreviewSource,
  onViewLog,
}: {
  jobs: IngestJob[]
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  onPreviewSource?: (job: IngestJob) => void
  onViewLog?: (job: IngestJob) => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  // jobs are already sorted by created_at descending (newest first) from groupByReview
  const activeJob = activeJobOfGroup(jobs)
  const historyJobs = jobs.slice(1)
  const hasHistory = historyJobs.length > 0
  const canPreview = isPreviewable(activeJob.source_path)
  const fileName = extractFileName(activeJob.source_path)

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Group header */}
      <div className="bg-muted/30 px-4 py-2 border-b">
        <p className="text-xs font-medium text-muted-foreground">
          {t("jobs.group.archive_title")} · {fileName}
        </p>
      </div>

      {/* Active job body */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {canPreview && onPreviewSource ? (
            <button
              type="button"
              onClick={() => onPreviewSource(activeJob)}
              className="text-sm font-medium truncate text-left cursor-pointer text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
              title={activeJob.source_path}
            >
              {activeJob.source_path}
            </button>
          ) : (
            <p className="text-sm font-medium truncate">{activeJob.source_path}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeJob.input_type} · {new Date(activeJob.created_at).toLocaleString()}
          </p>
          {(activeJob.error_message || activeJob.remediation) && (
            <div className="mt-1.5 text-xs text-red-600 dark:text-red-400 space-y-0.5">
              {activeJob.error_message && <p>{activeJob.error_message}</p>}
              {activeJob.remediation && (
                <p className="text-muted-foreground">{activeJob.remediation}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <StatusBadge status={activeJob.status} />
          {activeJob.status !== "queued" && onViewLog && (
            <Button size="sm" variant="ghost" onClick={() => onViewLog(activeJob)}>
              {t("jobs.log")}
            </Button>
          )}
          {activeJob.status === "failed" && (
            <Button size="sm" variant="outline" onClick={() => onRetry(activeJob.id)}>
              {t("jobs.retry")}
            </Button>
          )}
          {activeJob.status === "cancelled" && (
            <Button size="sm" variant="outline" onClick={() => onRetry(activeJob.id)}>
              {t("jobs.restart")}
            </Button>
          )}
          {(activeJob.status === "queued" || activeJob.status === "running") && (
            <Button size="sm" variant="outline" onClick={() => onCancel(activeJob.id)}>
              {t("jobs.cancel")}
            </Button>
          )}
        </div>
      </div>

      {/* History section */}
      {hasHistory && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="w-full px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors text-left flex items-center gap-1"
          >
            <span
              className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            {t("jobs.group.history_count", { count: historyJobs.length })}
          </button>
          {expanded && (
            <div className="px-4 pb-3 space-y-1">
              {historyJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between gap-2 py-1 text-xs text-muted-foreground"
                >
                  <span className="truncate">{job.input_type}</span>
                  <StatusBadge status={job.status} />
                  <span className="shrink-0">{new Date(job.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
