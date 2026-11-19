import type { Context } from "hono";
import { record } from "../activity/index.js";
import { enqueueReviewApplyJob, enqueueReviewPlanJob } from "../ingest/processor.js";
import type { IngestReview, IngestReviewMessage } from "../store/types.js";
import {
  getID,
  readJsonBody,
  writeError,
  writeJson,
  type ApiContext,
} from "./context.js";

export function ingestReviewsApi(ctx: ApiContext) {
  async function loadReview(c: Context): Promise<IngestReview | Response> {
    try {
      const review = await ctx.db.getIngestReview(getID(c));
      if (!review) return writeError(c, 404, "review not found");
      return review;
    } catch (error) {
      return writeError(c, 500, errorMessage(error));
    }
  }

  function logReviewLifecycle(
    reviewId: string,
    sessionId: string,
    action: string,
    message: string,
    status: string,
  ): void {
    record(ctx.db, {
      level: "info",
      category: "ingest",
      action,
      message,
      resourceType: "review",
      resourceId: reviewId,
      status,
      source: "api",
      details: sessionId ? { review_id: reviewId, session_id: sessionId } : { review_id: reviewId },
    });
  }

  return {
    async listIngestReviews(c: Context): Promise<Response> {
      try {
        return writeJson(c, 200, { reviews: await ctx.db.listIngestReviews(100) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async getIngestReview(c: Context): Promise<Response> {
      const review = await loadReview(c);
      if (review instanceof Response) return review;
      return writeJson(c, 200, { review });
    },

    async listIngestReviewPlans(c: Context): Promise<Response> {
      const review = await loadReview(c);
      if (review instanceof Response) return review;
      try {
        return writeJson(c, 200, { plans: await ctx.db.listIngestReviewPlans(getID(c)) });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async addIngestReviewFeedback(c: Context): Promise<Response> {
      const review = await loadReview(c);
      if (review instanceof Response) return review;
      if (review.status !== "ready_for_review" && review.status !== "failed") {
        return writeError(c, 409, "feedback only allowed when review is ready or failed");
      }
      const req = await readJsonBody<{ content?: string }>(c);
      if (!req) return writeError(c, 400, "invalid request body");
      const content = (req.content ?? "").trim();
      if (!content) return writeError(c, 400, "content is required");
      const message: IngestReviewMessage = {
        id: "",
        review_id: getID(c),
        role: "user",
        message_type: "feedback",
        content,
        created_at: "",
      };
      try {
        await ctx.db.createIngestReviewMessage(message);
        return writeJson(c, 201, { message });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async replanIngestReview(c: Context): Promise<Response> {
      const review = await loadReview(c);
      if (review instanceof Response) return review;
      if (review.status !== "ready_for_review" && review.status !== "failed") {
        return writeError(c, 409, "replan only allowed from ready_for_review or failed");
      }
      try {
        await ctx.db.updateIngestReviewStatus(getID(c), "revising");
        const job = await enqueueReviewPlanJob(ctx.db, ctx.workspace, review);
        const updated = (await ctx.db.getIngestReview(getID(c))) ?? review;
        logReviewLifecycle(getID(c), updated.session_id, "review_replanning", "replan queued", "pending");
        return writeJson(c, 202, {
          review: updated,
          job_id: job.id,
          status: updated.status,
          message: "replan started",
        });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },

    async approveIngestReview(c: Context): Promise<Response> {
      const review = await loadReview(c);
      if (review instanceof Response) return review;
      if (review.status !== "ready_for_review") {
        return writeError(c, 409, "approve only allowed when ready_for_review");
      }
      if (review.current_plan_version <= 0) {
        return writeError(c, 409, "no plan version to approve");
      }
      try {
        await ctx.db.setIngestReviewApprovedPlan(getID(c), review.current_plan_version);
        await ctx.db.updateIngestReviewStatus(getID(c), "approved");
        const updated = (await ctx.db.getIngestReview(getID(c))) ?? review;
        const job = await enqueueReviewApplyJob(ctx.db, ctx.workspace, updated);
        logReviewLifecycle(getID(c), updated.session_id, "review_approved", "approved; apply queued", "success");
        return writeJson(c, 202, {
          review: updated,
          job_id: job.id,
          status: updated.status,
          message: "apply started",
        });
      } catch (error) {
        return writeError(c, 500, errorMessage(error));
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
