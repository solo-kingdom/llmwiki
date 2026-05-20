import { Button } from "@/components/ui/button"
import type { IngestJob } from "@/types"
import { isPreviewable } from "@/components/SourcePreviewDialog"

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

export function JobCard({
  job,
  onRetry,
  onCancel,
  onPreviewSource,
  onViewLog,
}: {
  job: IngestJob
  onRetry: (id: string) => void
  onCancel: (id: string) => void
  onPreviewSource?: (job: IngestJob) => void
  onViewLog?: (job: IngestJob) => void
}) {
  const canPreview = isPreviewable(job.source_path)

  return (
    <div className="border rounded-lg px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {canPreview && onPreviewSource ? (
          <button
            type="button"
            onClick={() => onPreviewSource(job)}
            className="text-sm font-medium truncate text-left cursor-pointer text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
            title={job.source_path}
          >
            {job.source_path}
          </button>
        ) : (
          <p className="text-sm font-medium truncate">{job.source_path}</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          {job.input_type} · {new Date(job.created_at).toLocaleString()}
        </p>
        {(job.error_message || job.remediation) && (
          <div className="mt-1.5 text-xs text-red-600 dark:text-red-400 space-y-0.5">
            {job.error_message && <p>{job.error_message}</p>}
            {job.remediation && (
              <p className="text-muted-foreground">{job.remediation}</p>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
        <StatusBadge status={job.status} />
        {job.status !== "queued" && onViewLog && (
          <Button size="sm" variant="ghost" onClick={() => onViewLog(job)}>
            日志
          </Button>
        )}
        {job.status === "failed" && (
          <Button size="sm" variant="outline" onClick={() => onRetry(job.id)}>
            Retry
          </Button>
        )}
        {job.status === "cancelled" && (
          <Button size="sm" variant="outline" onClick={() => onRetry(job.id)}>
            Restart
          </Button>
        )}
        {(job.status === "queued" || job.status === "running") && (
          <Button size="sm" variant="outline" onClick={() => onCancel(job.id)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
