import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/context/AppContext"
import { useT } from "@/i18n"
import { JobCard } from "@/components/JobCard"
import { JobGroupCard } from "@/components/JobGroupCard"
import { PageContainer } from "@/components/PageContainer"
import { StatusFilter, type StatusKey } from "@/components/StatusFilter"
import { SourcePreviewDialog } from "@/components/SourcePreviewDialog"
import { JobLogDialog } from "@/components/JobLogDialog"
import { groupByReview, activeJobOfGroup } from "@/lib/job-grouping"
import type { IngestJob } from "@/types"

/** A renderable item — either a review group or a flat job */
type RenderItem =
  | { type: "group"; sourceRef: string; jobs: IngestJob[] }
  | { type: "flat"; job: IngestJob }

export function JobsPage() {
  const t = useT()
  const { ingestJobs, refreshIngestJobs, retryIngest, cancelIngest } = useApp()
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all")
  const [previewJob, setPreviewJob] = useState<IngestJob | null>(null)
  const [logJob, setLogJob] = useState<IngestJob | null>(null)

  useEffect(() => {
    refreshIngestJobs()
    const t = setInterval(() => {
      refreshIngestJobs()
    }, 3000)
    return () => clearInterval(t)
  }, [refreshIngestJobs])

  // Group jobs by review source_ref, memoized
  const { groups, flat } = useMemo(
    () => groupByReview(ingestJobs),
    [ingestJobs],
  )

  // Build the unified sorted render list with status filtering
  const renderItems = useMemo(() => {
    // Collect all renderable items
    const items: RenderItem[] = []

    // Add groups
    for (const [sourceRef, jobs] of groups) {
      // Filter: show group if any job matches the status filter
      if (statusFilter !== "all") {
        const hasMatch = jobs.some((j) => j.status === statusFilter)
        if (!hasMatch) continue
      }
      items.push({ type: "group", sourceRef, jobs })
    }

    // Add flat jobs
    const filteredFlat =
      statusFilter === "all"
        ? flat
        : flat.filter((j) => j.status === statusFilter)
    for (const job of filteredFlat) {
      items.push({ type: "flat", job })
    }

    // Sort all items by the newest job's created_at descending
    items.sort((a, b) => {
      const aTime = new Date(
        a.type === "group"
          ? activeJobOfGroup(a.jobs).created_at
          : a.job.created_at,
      ).getTime()
      const bTime = new Date(
        b.type === "group"
          ? activeJobOfGroup(b.jobs).created_at
          : b.job.created_at,
      ).getTime()
      return bTime - aTime
    })

    return items
  }, [groups, flat, statusFilter])

  return (
    <PageContainer>
      <div className="space-y-4">
        <StatusFilter
          jobs={ingestJobs}
          selected={statusFilter}
          onSelect={setStatusFilter}
        />

        <div className="space-y-2">
          {renderItems.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("jobs.empty")}
            </p>
          )}
          {renderItems.map((item) =>
            item.type === "group" ? (
              <JobGroupCard
                key={item.sourceRef}
                jobs={item.jobs}
                onRetry={retryIngest}
                onCancel={cancelIngest}
                onPreviewSource={setPreviewJob}
                onViewLog={setLogJob}
              />
            ) : (
              <JobCard
                key={item.job.id}
                job={item.job}
                onRetry={retryIngest}
                onCancel={cancelIngest}
                onPreviewSource={setPreviewJob}
                onViewLog={setLogJob}
              />
            ),
          )}
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

      <JobLogDialog
        open={logJob !== null}
        onOpenChange={(open) => {
          if (!open) setLogJob(null)
        }}
        job={logJob}
      />
    </PageContainer>
  )
}
