import { useCallback, useEffect, useMemo, useState } from "react"
import { useT } from "@/i18n"
import { MarkdownContent } from "@/components/MarkdownContent"
import type { MessageKey } from "@/i18n"
import { navigateTo, timelineCommitHref } from "@/lib/wiki-routes"
import * as api from "@/lib/api"
import type { IngestJob, IngestReview, IngestReviewPlan } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { AlertCircle, CheckCircle2, Eye, Loader2, RefreshCw } from "lucide-react"

const REVIEW_STATUS_LABEL_KEYS = {
  planning: "review.status.planning",
  ready_for_review: "review.status.ready_for_review",
  revising: "review.status.revising",
  approved: "review.status.approved",
  applying: "review.status.applying",
  succeeded: "review.status.succeeded",
  failed: "review.status.failed",
  cancelled: "review.status.cancelled",
} as const satisfies Record<IngestReview["status"], MessageKey>

function reviewStatusLabel(
  status: IngestReview["status"],
  t: ReturnType<typeof useT>,
): string {
  return t(REVIEW_STATUS_LABEL_KEYS[status])
}

function parseAppliedPageCount(summary: string): number | null {
  const m = summary.match(/applied\s+(\d+)\s+wiki\s+page/i)
  if (m) return Number.parseInt(m[1], 10)
  const zh = summary.match(/写入了\s*(\d+)\s*个/)
  if (zh) return Number.parseInt(zh[1], 10)
  return null
}

function isZeroPageApplyFailure(review: IngestReview, job: IngestJob | null): boolean {
  if (review.status === "failed") {
    return job?.error_code === "no_wiki_files_written"
  }
  if (review.status === "succeeded" && job?.result_summary) {
    const n = parseAppliedPageCount(job.result_summary)
    return n === 0
  }
  return false
}

interface ArchiveReviewCardProps {
  reviewId: string
}

export function ArchiveReviewCard({ reviewId }: ArchiveReviewCardProps) {
  const t = useT()
  const [review, setReview] = useState<IngestReview | null>(null)
  const [applyJob, setApplyJob] = useState<IngestJob | null>(null)
  const [plans, setPlans] = useState<IngestReviewPlan[]>([])
  const [planVersion, setPlanVersion] = useState<number | null>(null)
  const [feedback, setFeedback] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReview = useCallback(async () => {
    try {
      const r = await api.getIngestReview(reviewId)
      setReview(r)
      if (r.final_job_id) {
        try {
          const { job } = await api.getIngestJob(r.final_job_id)
          setApplyJob(job)
        } catch {
          setApplyJob(null)
        }
      } else {
        setApplyJob(null)
      }
      return r
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [reviewId])

  const loadPlans = useCallback(async () => {
    try {
      const p = await api.listIngestReviewPlans(reviewId)
      setPlans(p)
      if (p.length > 0) {
        setPlanVersion((cur) => cur ?? p[p.length - 1].version)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [reviewId])

  useEffect(() => {
    void loadReview()
    void loadPlans()
  }, [loadReview, loadPlans])

  useEffect(() => {
    if (!review) return
    const terminal = review.status === "succeeded" || review.status === "failed" || review.status === "cancelled"
    if (terminal) return
    const timer = setInterval(() => {
      void loadReview().then((r) => {
        if (r && (r.status === "ready_for_review" || r.status === "failed" || r.status === "succeeded")) {
          void loadPlans()
        }
      })
    }, 5000)
    return () => clearInterval(timer)
  }, [review?.status, loadReview, loadPlans, review])

  const activePlan = useMemo(
    () => plans.find((p) => p.version === planVersion) ?? plans[plans.length - 1],
    [plans, planVersion],
  )

  const zeroPageFailure = review ? isZeroPageApplyFailure(review, applyJob) : false
  const appliedCount =
    applyJob?.result_summary != null ? parseAppliedPageCount(applyJob.result_summary) : null
  const showApplySuccess =
    review?.status === "succeeded" && !zeroPageFailure && (appliedCount == null || appliedCount > 0)

  const canFeedback =
    review?.status === "ready_for_review" || review?.status === "failed"
  const canReplan =
    review?.status === "ready_for_review" || review?.status === "failed"
  const canApprove = review?.status === "ready_for_review"
  const isWorking =
    review?.status === "planning" ||
    review?.status === "revising" ||
    review?.status === "applying" ||
    review?.status === "approved"

  const handleFeedback = async () => {
    if (!feedback.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.addIngestReviewFeedback(reviewId, feedback.trim())
      setFeedback("")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleReplan = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.replanIngestReview(reviewId)
      await loadReview()
      await loadPlans()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleApprove = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.approveIngestReview(reviewId)
      await loadReview()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!review) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("review.loading")}
      </div>
    )
  }

  return (
    <div className="mb-2 rounded-lg border border-border/70 bg-card/80">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">{t("chat.review.card_title")}</span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
          {reviewStatusLabel(review.status, t)}
        </span>
        {isWorking && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {showApplySuccess && (
          <CheckCircle2 className="size-4 text-green-600" />
        )}
        {(review.status === "failed" || zeroPageFailure) && (
          <AlertCircle className="size-4 text-destructive" />
        )}
      </div>

      {plans.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b px-3 py-2">
          {plans.map((p) => (
            <Button
              key={p.version}
              size="sm"
              variant={planVersion === p.version ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setPlanVersion(p.version)}
            >
              v{p.version}
            </Button>
          ))}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto px-3 py-2">
        {activePlan ? (
          <MarkdownContent variant="reader" content={activePlan.plan_markdown} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("review.no_plan")}</p>
        )}
      </div>

      {zeroPageFailure && (
        <div className="border-t px-3 py-2 text-sm text-destructive" role="alert">
          <p>{t("chat.review.apply_failed_zero_pages")}</p>
          {applyJob?.remediation ? (
            <p className="mt-1 text-xs text-muted-foreground">{applyJob.remediation}</p>
          ) : null}
        </div>
      )}

      {showApplySuccess && (
        <div className="border-t px-3 py-2 text-sm">
          <p className="text-muted-foreground">
            {appliedCount != null && appliedCount > 0
              ? t("chat.review.apply_success_count", { count: appliedCount })
              : t("chat.review.apply_success")}
          </p>
          {review.merge_commit_sha ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => navigateTo(timelineCommitHref(review.merge_commit_sha!))}
            >
              <Eye className="mr-1 size-3.5" />
              {t("chat.review.view_diff")}
            </Button>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("chat.review.no_diff")}</p>
          )}
        </div>
      )}

      {(canFeedback || canReplan || canApprove || review.status === "failed") && (
        <div className="space-y-2 border-t p-3">
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {review.status === "failed" && !zeroPageFailure && applyJob?.error_message && (
            <p className="text-sm text-destructive" role="alert">
              {applyJob.error_message}
            </p>
          )}
          {canFeedback && (
            <Input
              placeholder={t("review.feedback_placeholder")}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={busy}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {canFeedback && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !feedback.trim()}
                onClick={() => void handleFeedback()}
              >
                {t("review.submit_feedback")}
              </Button>
            )}
            {(canReplan || review.status === "failed") && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void handleReplan()}
              >
                <RefreshCw className={cn("mr-1 size-3.5", busy && "animate-spin")} />
                {t("review.replan")}
              </Button>
            )}
            {canApprove && (
              <Button size="sm" disabled={busy} onClick={() => void handleApprove()}>
                {t("chat.review.confirm_apply")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
