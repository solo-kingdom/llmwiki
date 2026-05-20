import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/context/AppContext"
import { JobCard } from "@/components/JobCard"
import { PageContainer } from "@/components/PageContainer"
import { StatusFilter, type StatusKey } from "@/components/StatusFilter"
import { SourcePreviewDialog } from "@/components/SourcePreviewDialog"
import type { IngestJob } from "@/types"

export function JobsPage() {
  const { ingestJobs, refreshIngestJobs, retryIngest, cancelIngest } = useApp()
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all")
  const [previewJob, setPreviewJob] = useState<IngestJob | null>(null)

  useEffect(() => {
    refreshIngestJobs()
    const t = setInterval(() => {
      refreshIngestJobs()
    }, 3000)
    return () => clearInterval(t)
  }, [refreshIngestJobs])

  const filteredJobs = useMemo(() => {
    if (statusFilter === "all") return ingestJobs
    return ingestJobs.filter((j) => j.status === statusFilter)
  }, [ingestJobs, statusFilter])

  return (
    <PageContainer>
      <div className="space-y-4">
        <StatusFilter
          jobs={ingestJobs}
          selected={statusFilter}
          onSelect={setStatusFilter}
        />

        <div className="space-y-2">
          {filteredJobs.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无摄入任务
            </p>
          )}
          {filteredJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onRetry={retryIngest}
              onCancel={cancelIngest}
              onPreviewSource={setPreviewJob}
            />
          ))}
        </div>
      </div>

      <SourcePreviewDialog
        open={previewJob !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewJob(null)
        }}
        jobId={previewJob?.id ?? null}
        sourcePath={previewJob?.source_path ?? ""}
      />
    </PageContainer>
  )
}
