import { useMemo } from "react"
import type { IngestJob } from "@/types"

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "running", label: "Running" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
] as const

type StatusKey = (typeof STATUS_TABS)[number]["key"]

export function StatusFilter({
  jobs,
  selected,
  onSelect,
}: {
  jobs: IngestJob[]
  selected: StatusKey
  onSelect: (key: StatusKey) => void
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs.length }
    for (const job of jobs) {
      c[job.status] = (c[job.status] || 0) + 1
    }
    return c
  }, [jobs])

  return (
    <div className="flex gap-1 overflow-x-auto">
      {STATUS_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelect(tab.key)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none whitespace-nowrap ${
            selected === tab.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {tab.label}
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              selected === tab.key
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {counts[tab.key] || 0}
          </span>
        </button>
      ))}
    </div>
  )
}

export type { StatusKey }
