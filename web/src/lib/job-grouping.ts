import type { IngestJob } from "@/types"

const REVIEW_PREFIX = "review:"

/**
 * Check if a job's source_ref indicates it belongs to a review group.
 */
export function isReviewRef(sourceRef: string): boolean {
  return sourceRef.startsWith(REVIEW_PREFIX)
}

/**
 * Group jobs by their `source_ref` when it starts with "review:".
 * Returns a Map of grouped review jobs (keyed by source_ref) and an array
 * of ungrouped (flat) jobs that are not review-related.
 *
 * Within each group, jobs are sorted by `created_at` descending (newest first).
 */
export function groupByReview(
  jobs: IngestJob[],
): { groups: Map<string, IngestJob[]>; flat: IngestJob[] } {
  const groups = new Map<string, IngestJob[]>()
  const flat: IngestJob[] = []

  for (const job of jobs) {
    if (isReviewRef(job.source_ref)) {
      const existing = groups.get(job.source_ref)
      if (existing) {
        existing.push(job)
      } else {
        groups.set(job.source_ref, [job])
      }
    } else {
      flat.push(job)
    }
  }

  // Sort each group by created_at descending (newest first)
  for (const jobs of groups.values()) {
    jobs.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }

  return { groups, flat }
}

/**
 * Return the active (most recent) job of a group.
 * Assumes the group array is already sorted by created_at descending.
 */
export function activeJobOfGroup(jobs: IngestJob[]): IngestJob {
  if (jobs.length === 0) {
    throw new Error("activeJobOfGroup: empty jobs array")
  }
  return jobs[0]
}
