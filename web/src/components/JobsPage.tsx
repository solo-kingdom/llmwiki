import { useEffect, useMemo, useState } from "react"
import { useApp } from "@/context/AppContext"
import { JobCard } from "@/components/JobCard"
import { StatusFilter, type StatusKey } from "@/components/StatusFilter"

export function JobsPage() {
  const { ingestJobs, refreshIngestJobs, retryIngest, cancelIngest } = useApp()
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all")

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
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Ingest Jobs</h1>

      <StatusFilter
        jobs={ingestJobs}
        selected={statusFilter}
        onSelect={setStatusFilter}
      />

      <div className="space-y-2">
        {filteredJobs.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            暂无摄入任务
          </p>
        )}
        {filteredJobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onRetry={retryIngest}
            onCancel={cancelIngest}
          />
        ))}
      </div>
    </div>
  )
}
