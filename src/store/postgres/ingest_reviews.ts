import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ReviewStore } from "../interfaces.js";
import type {
  IngestReview,
  IngestReviewMessage,
  IngestReviewPlan,
} from "../types.js";
import { NOW_TEXT, asBoolean, asNumber, asString, exec, queryOne, queryRows } from "./sql.js";

const REVIEW_COLUMNS = `
  COALESCE(id, ''), COALESCE(session_id, ''), COALESCE(archive_source_path, ''),
  COALESCE(status, ''), COALESCE(current_plan_version, 0),
  COALESCE(approved_plan_version, 0), COALESCE(final_job_id, ''),
  COALESCE(change_set_id, ''),
  COALESCE(created_at, ''), COALESCE(updated_at, ''),
  COALESCE(deep_organize, FALSE), COALESCE(archive_file_id, '')`;

const REVIEW_MESSAGE_COLUMNS = `
  COALESCE(id, ''), COALESCE(review_id, ''), COALESCE(role, ''),
  COALESCE(message_type, ''), COALESCE(content, ''), COALESCE(created_at, '')`;

const REVIEW_PLAN_COLUMNS = `
  COALESCE(id, ''), COALESCE(review_id, ''), COALESCE(version, 0),
  COALESCE(plan_markdown, ''), COALESCE(plan_json, ''), COALESCE(created_at, '')`;

const VALID_REVIEW_STATUSES = new Set([
  "planning",
  "ready_for_review",
  "revising",
  "approved",
  "applying",
  "succeeded",
  "failed",
  "cancelled",
]);

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  planning: ["ready_for_review", "failed", "cancelled"],
  ready_for_review: ["revising", "approved", "cancelled"],
  revising: ["ready_for_review", "failed", "cancelled"],
  approved: ["applying"],
  applying: ["succeeded", "failed"],
  failed: ["revising", "cancelled"],
};

function validateReviewStatus(status: string): void {
  if (!VALID_REVIEW_STATUSES.has(status.trim())) {
    throw new Error(`invalid ingest review status: ${status}`);
  }
}

function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

function scanReview(row: unknown[]): IngestReview {
  return {
    id: asString(row[0]),
    session_id: asString(row[1]),
    archive_source_path: asString(row[2]),
    status: asString(row[3]),
    current_plan_version: asNumber(row[4]),
    approved_plan_version: asNumber(row[5]),
    final_job_id: asString(row[6]),
    change_set_id: asString(row[7]),
    created_at: asString(row[8]),
    updated_at: asString(row[9]),
    deep_organize: asBoolean(row[10]),
    archive_file_id: asString(row[11]),
  };
}

function scanReviewMessage(row: unknown[]): IngestReviewMessage {
  return {
    id: asString(row[0]),
    review_id: asString(row[1]),
    role: asString(row[2]),
    message_type: asString(row[3]),
    content: asString(row[4]),
    created_at: asString(row[5]),
  };
}

function scanReviewPlan(row: unknown[]): IngestReviewPlan {
  return {
    id: asString(row[0]),
    review_id: asString(row[1]),
    version: asNumber(row[2]),
    plan_markdown: asString(row[3]),
    plan_json: asString(row[4]),
    created_at: asString(row[5]),
  };
}

export function ingestReviewsRepo(pool: Pool): ReviewStore {
  return {
    async createIngestReview(review: IngestReview): Promise<void> {
      if (!review) throw new Error("nil ingest review");
      if (!review.archive_source_path) throw new Error("archive_source_path is required");
      if (!review.status) review.status = "planning";
      validateReviewStatus(review.status);
      const row = await queryOne(
        pool,
        `INSERT INTO ingest_reviews (
          id, session_id, archive_source_path, archive_file_id, status,
          current_plan_version, approved_plan_version, final_job_id,
          deep_organize, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${NOW_TEXT}, ${NOW_TEXT})
        RETURNING ${REVIEW_COLUMNS}`,
        [
          randomUUID(),
          review.session_id,
          review.archive_source_path,
          (review.archive_file_id ?? "").trim(),
          review.status,
          review.current_plan_version,
          review.approved_plan_version,
          review.final_job_id ?? "",
          review.deep_organize,
        ],
      );
      if (!row) throw new Error("create ingest review: no row returned");
      Object.assign(review, scanReview(row));
    },

    async getIngestReview(id: string): Promise<IngestReview | null> {
      const row = await queryOne(
        pool,
        `SELECT ${REVIEW_COLUMNS} FROM ingest_reviews WHERE id = $1`,
        [id],
      );
      return row ? scanReview(row) : null;
    },

    async getLatestIngestReviewBySessionID(sessionID: string): Promise<IngestReview | null> {
      const session = sessionID.trim();
      if (!session) return null;
      const row = await queryOne(
        pool,
        `SELECT ${REVIEW_COLUMNS}
         FROM ingest_reviews
         WHERE session_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [session],
      );
      return row ? scanReview(row) : null;
    },

    async countIngestReviewsBySessionID(sessionID: string): Promise<number> {
      const row = await queryOne<[number]>(
        pool,
        "SELECT COUNT(*) FROM ingest_reviews WHERE session_id = $1",
        [sessionID],
      );
      return row ? asNumber(row[0]) : 0;
    },

    async deleteIngestReview(id: string): Promise<void> {
      if (!id.trim()) throw new Error("review id is required");
      await exec(pool, "DELETE FROM ingest_reviews WHERE id = $1", [id]);
    },

    async listIngestReviews(limit: number): Promise<IngestReview[]> {
      const effectiveLimit = limit <= 0 ? 50 : limit;
      const rows = await queryRows(
        pool,
        `SELECT ${REVIEW_COLUMNS}
         FROM ingest_reviews
         ORDER BY updated_at DESC, id DESC
         LIMIT $1`,
        [effectiveLimit],
      );
      return rows.map(scanReview);
    },

    async updateIngestReviewStatus(id: string, newStatus: string): Promise<void> {
      validateReviewStatus(newStatus);
      const current = await this.getIngestReview(id);
      if (!current) throw new Error(`review not found: ${id}`);
      if (current.status === newStatus) {
        await exec(
          pool,
          `UPDATE ingest_reviews SET updated_at = ${NOW_TEXT} WHERE id = $1`,
          [id],
        );
        return;
      }
      if (!canTransition(current.status, newStatus)) {
        throw new Error(`invalid review status transition: ${current.status} -> ${newStatus}`);
      }
      await exec(
        pool,
        `UPDATE ingest_reviews SET status = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [newStatus, id],
      );
    },

    async setIngestReviewPlanVersion(id: string, version: number): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_reviews SET current_plan_version = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [version, id],
      );
    },

    async setIngestReviewApprovedPlan(id: string, version: number): Promise<void> {
      const current = await this.getIngestReview(id);
      if (!current) throw new Error(`review not found: ${id}`);
      if (version <= 0) throw new Error("approved plan version must be positive");
      if (version > current.current_plan_version) {
        throw new Error(
          `approved version ${version} exceeds current ${current.current_plan_version}`,
        );
      }
      await exec(
        pool,
        `UPDATE ingest_reviews
         SET approved_plan_version = $1, updated_at = ${NOW_TEXT}
         WHERE id = $2`,
        [version, id],
      );
    },

    async setIngestReviewFinalJob(id: string, jobID: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_reviews SET final_job_id = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [jobID, id],
      );
    },

    async setIngestReviewChangeSet(id: string, changeSetID: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_reviews SET change_set_id = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [changeSetID, id],
      );
    },

    async createIngestReviewMessage(msg: IngestReviewMessage): Promise<void> {
      if (!msg || !msg.review_id) throw new Error("review_id is required");
      if (!msg.role) msg.role = "user";
      if (!msg.message_type) msg.message_type = "feedback";
      const row = await queryOne(
        pool,
        `INSERT INTO ingest_review_messages (id, review_id, role, message_type, content, created_at)
         VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})
         RETURNING ${REVIEW_MESSAGE_COLUMNS}`,
        [randomUUID(), msg.review_id, msg.role, msg.message_type, msg.content],
      );
      if (!row) throw new Error("create ingest review message: no row returned");
      Object.assign(msg, scanReviewMessage(row));
    },

    async listIngestReviewMessages(reviewID: string): Promise<IngestReviewMessage[]> {
      const rows = await queryRows(
        pool,
        `SELECT ${REVIEW_MESSAGE_COLUMNS}
         FROM ingest_review_messages
         WHERE review_id = $1
         ORDER BY created_at ASC, id ASC`,
        [reviewID],
      );
      return rows.map(scanReviewMessage);
    },

    async createIngestReviewPlan(plan: IngestReviewPlan): Promise<void> {
      if (!plan || !plan.review_id) throw new Error("review_id is required");
      if (plan.version <= 0) throw new Error("plan version must be positive");
      const row = await queryOne(
        pool,
        `INSERT INTO ingest_review_plans (id, review_id, version, plan_markdown, plan_json, created_at)
         VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})
         RETURNING ${REVIEW_PLAN_COLUMNS}`,
        [randomUUID(), plan.review_id, plan.version, plan.plan_markdown, plan.plan_json],
      );
      if (!row) throw new Error("create ingest review plan: no row returned");
      Object.assign(plan, scanReviewPlan(row));
    },

    async listIngestReviewPlans(reviewID: string): Promise<IngestReviewPlan[]> {
      const rows = await queryRows(
        pool,
        `SELECT ${REVIEW_PLAN_COLUMNS}
         FROM ingest_review_plans
         WHERE review_id = $1
         ORDER BY version ASC`,
        [reviewID],
      );
      return rows.map(scanReviewPlan);
    },

    async getIngestReviewPlan(reviewID: string, version: number): Promise<IngestReviewPlan | null> {
      const row = await queryOne(
        pool,
        `SELECT ${REVIEW_PLAN_COLUMNS}
         FROM ingest_review_plans
         WHERE review_id = $1 AND version = $2`,
        [reviewID, version],
      );
      return row ? scanReviewPlan(row) : null;
    },

    async nextIngestReviewPlanVersion(reviewID: string): Promise<number> {
      const row = await queryOne<[number]>(
        pool,
        "SELECT COALESCE(MAX(version), 0) FROM ingest_review_plans WHERE review_id = $1",
        [reviewID],
      );
      return (row ? asNumber(row[0]) : 0) + 1;
    },
  };
}
