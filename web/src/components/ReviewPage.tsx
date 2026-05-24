import { useCallback, useEffect, useMemo, useState } from "react"
import { useT } from "@/i18n"
import { MarkdownContent } from "@/components/MarkdownContent"
import type { MessageKey } from "@/i18n"
import { navigateTo, workbenchViewHref } from "@/lib/wiki-routes"
import * as api from "@/lib/api"
import type { IngestReview, IngestReviewPlan } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react"

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

export function ReviewPage() {
  const t = useT()
  const [reviews, setReviews] = useState<IngestReview[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [plans, setPlans] = useState<IngestReviewPlan[]>([])
  const [planVersion, setPlanVersion] = useState<number | null>(null)
  const [feedback, setFeedback] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadReviews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.listIngestReviews()
      setReviews(list)
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void loadReviews()
    const timer = setInterval(() => void loadReviews(), 5000)
    return () => clearInterval(timer)
  }, [loadReviews])

  const selected = useMemo(
    () => reviews.find((r) => r.id === selectedId) ?? null,
    [reviews, selectedId],
  )

  const loadPlans = useCallback(async (reviewId: string) => {
    try {
      const p = await api.listIngestReviewPlans(reviewId)
      setPlans(p)
      if (p.length > 0) {
        setPlanVersion((cur) => cur ?? p[p.length - 1].version)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    void loadPlans(selectedId)
  }, [selectedId, selected?.current_plan_version, selected?.status, loadPlans])

  const activePlan = useMemo(
    () => plans.find((p) => p.version === planVersion) ?? plans[plans.length - 1],
    [plans, planVersion],
  )

  const canFeedback =
    selected?.status === "ready_for_review" || selected?.status === "failed"
  const canReplan =
    selected?.status === "ready_for_review" || selected?.status === "failed"
  const canApprove = selected?.status === "ready_for_review"
  const isWorking =
    selected?.status === "planning" ||
    selected?.status === "revising" ||
    selected?.status === "applying" ||
    selected?.status === "approved"

  const handleFeedback = async () => {
    if (!selectedId || !feedback.trim()) return
    setBusy(true)
    try {
      await api.addIngestReviewFeedback(selectedId, feedback.trim())
      setFeedback("")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleReplan = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await api.replanIngestReview(selectedId)
      await loadReviews()
      await loadPlans(selectedId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleApprove = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await api.approveIngestReview(selectedId)
      await loadReviews()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-2">
      <aside className="flex w-56 shrink-0 flex-col rounded-xl border border-border/70 bg-card/70">
        <div className="border-b px-3 py-2 text-sm font-medium">{t("review.list_title")}</div>
        <ScrollArea className="min-h-0 flex-1">
          {loading && reviews.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t("review.loading")}</p>
          ) : reviews.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{t("review.empty")}</p>
          ) : (
            <ul className="p-1">
              {reviews.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-lg px-2 py-2 text-left text-sm transition-colors",
                      selectedId === r.id
                        ? "bg-muted font-medium"
                        : "hover:bg-muted/60",
                    )}
                    onClick={() => {
                      setSelectedId(r.id)
                      setPlanVersion(r.current_plan_version || null)
                    }}
                  >
                    <div className="truncate">{r.session_id || r.id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">
                      {reviewStatusLabel(r.status, t)}
                      {r.current_plan_version > 0 ? ` · v${r.current_plan_version}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border/70 bg-card/70">
        {!selected ? (
          <p className="p-6 text-sm text-muted-foreground">{t("review.select_hint")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <span className="text-sm font-medium">{t("review.detail_title")}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {reviewStatusLabel(selected.status, t)}
              </span>
              {isWorking && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              {selected.status === "succeeded" && (
                <CheckCircle2 className="size-4 text-green-600" />
              )}
              {selected.final_job_id && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => navigateTo(workbenchViewHref("jobs"))}
                >
                  {t("review.view_job")}: {selected.final_job_id.slice(0, 8)}…
                </Button>
              )}
            </div>

            {plans.length > 0 && (
              <div className="flex flex-wrap gap-1 border-b px-4 py-2">
                {plans.map((p) => (
                  <Button
                    key={p.version}
                    size="sm"
                    variant={planVersion === p.version ? "default" : "outline"}
                    onClick={() => setPlanVersion(p.version)}
                  >
                    v{p.version}
                  </Button>
                ))}
              </div>
            )}

            <ScrollArea className="min-h-0 flex-1 px-4 py-3">
              {activePlan ? (
                <MarkdownContent
                  variant="reader"
                  content={activePlan.plan_markdown}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t("review.no_plan")}</p>
              )}
            </ScrollArea>

            <div className="space-y-2 border-t p-4">
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Input
                placeholder={t("review.feedback_placeholder")}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={!canFeedback || busy}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canFeedback || busy || !feedback.trim()}
                  onClick={() => void handleFeedback()}
                >
                  {t("review.submit_feedback")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canReplan || busy}
                  onClick={() => void handleReplan()}
                >
                  <RefreshCw className="mr-1 size-3.5" />
                  {t("review.replan")}
                </Button>
                <Button
                  size="sm"
                  disabled={!canApprove || busy}
                  onClick={() => void handleApprove()}
                >
                  {t("review.approve")}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
