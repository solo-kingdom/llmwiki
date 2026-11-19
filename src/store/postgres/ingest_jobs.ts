import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { JobStore } from "../interfaces.js";
import type { IngestJob } from "../types.js";
import {
  DEFAULT_JOB_EVENTS_MAX_COUNT,
  DEFAULT_MAX_CONCURRENT_JOBS,
  MAX_JOB_EVENTS_MAX_COUNT,
  MIN_JOB_EVENTS_MAX_COUNT,
  STALE_HEARTBEAT_SECONDS,
} from "../types.js";
import { NOW_TEXT, asNumber, asString, exec, queryOne, queryRows, withTransaction } from "./sql.js";

const JOB_COLUMNS = `
  COALESCE(id, ''), COALESCE(parent_job_id, ''), COALESCE(input_type, ''),
  COALESCE(source_path, ''), COALESCE(source_ref, ''), COALESCE(status, ''),
  COALESCE(retries, 0), COALESCE(max_retries, 3), COALESCE(error, ''),
  COALESCE(error_code, ''), COALESCE(error_message, ''),
  COALESCE(missing_dependency, ''), COALESCE(remediation, ''),
  COALESCE(result_summary, ''), COALESCE(runner_id, ''), COALESCE(heartbeat_at, ''),
  COALESCE(created_at, ''), COALESCE(updated_at, '')`;

const STALE_CUTOFF = `to_char((now() AT TIME ZONE 'utc') - interval '${STALE_HEARTBEAT_SECONDS} seconds', 'YYYY-MM-DD HH24:MI:SS')`;

const RECOVER_STALE_SQL = `
  UPDATE ingest_jobs SET
    status = 'queued',
    error = '', error_code = '', error_message = '',
    missing_dependency = '', remediation = '', result_summary = '',
    runner_id = '', heartbeat_at = '',
    updated_at = ${NOW_TEXT}
  WHERE status = 'running'
  AND (heartbeat_at = '' OR heartbeat_at < ${STALE_CUTOFF})`;

const VALID_STATUS = new Set(["queued", "running", "succeeded", "failed", "cancelled"]);

function normalizeJobStatus(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "pending":
      return "queued";
    case "processing":
      return "running";
    case "done":
      return "succeeded";
    default:
      return status.trim().toLowerCase();
  }
}

function validateJobStatus(status: string): void {
  if (!VALID_STATUS.has(normalizeJobStatus(status))) {
    throw new Error(`invalid ingest job status: ${status}`);
  }
}

function scanJob(row: unknown[]): IngestJob {
  return {
    id: asString(row[0]),
    parent_job_id: asString(row[1]),
    input_type: asString(row[2]),
    source_path: asString(row[3]),
    source_ref: asString(row[4]),
    status: normalizeJobStatus(asString(row[5])),
    retries: asNumber(row[6]),
    max_retries: asNumber(row[7]),
    error: asString(row[8]),
    error_code: asString(row[9]),
    error_message: asString(row[10]),
    missing_dependency: asString(row[11]),
    remediation: asString(row[12]),
    result_summary: asString(row[13]),
    runner_id: asString(row[14]),
    heartbeat_at: asString(row[15]),
    created_at: asString(row[16]),
    updated_at: asString(row[17]),
  };
}

function nullableID(id: string): string | null {
  const trimmed = id.trim();
  return trimmed === "" ? null : trimmed;
}

async function ingestConfigValue(db: Pool | PoolClient, key: string): Promise<string> {
  const row = await queryOne<[string]>(
    db,
    "SELECT COALESCE(value, '') FROM app_config WHERE key = $1",
    [key],
  );
  return row ? asString(row[0]) : "";
}

function clampJobEventsMaxCount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_JOB_EVENTS_MAX_COUNT;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_JOB_EVENTS_MAX_COUNT;
  if (parsed < MIN_JOB_EVENTS_MAX_COUNT) return MIN_JOB_EVENTS_MAX_COUNT;
  if (parsed > MAX_JOB_EVENTS_MAX_COUNT) return MAX_JOB_EVENTS_MAX_COUNT;
  return parsed;
}

async function concurrencyLimit(db: Pool | PoolClient): Promise<number> {
  const parallel = await ingestConfigValue(db, "job_parallel_enabled");
  if (parallel !== "true" && parallel !== "1") return 1;
  const raw = await ingestConfigValue(db, "job_max_concurrent");
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT_JOBS;
  return parsed;
}

export function ingestJobsRepo(pool: Pool): JobStore {
  async function trimIngestJobEvents(jobID: string, maxCount: number): Promise<void> {
    if (maxCount <= 0) return;
    await exec(
      pool,
      `DELETE FROM ingest_job_events
       WHERE job_id = $1
       AND id NOT IN (
         SELECT id FROM ingest_job_events
         WHERE job_id = $2
         ORDER BY id DESC
         LIMIT $3
       )`,
      [jobID, jobID, maxCount],
    );
  }

  return {
    async createIngestJob(job: IngestJob): Promise<void> {
      if (!job) throw new Error("nil ingest job");
      if (!job.source_path && job.input_type !== "rollback") {
        throw new Error("source_path is required");
      }
      if (!job.input_type) job.input_type = "file";
      if (!job.status) job.status = "queued";
      job.status = normalizeJobStatus(job.status);
      validateJobStatus(job.status);
      if (job.max_retries <= 0) job.max_retries = 3;

      const row = await queryOne(
        pool,
        `INSERT INTO ingest_jobs (
          id, parent_job_id, input_type, source_path, source_ref, status,
          retries, max_retries, error, error_code, error_message,
          missing_dependency, remediation, result_summary, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, ${NOW_TEXT}, ${NOW_TEXT})
        RETURNING ${JOB_COLUMNS}`,
        [
          randomUUID(),
          nullableID(job.parent_job_id),
          job.input_type.trim(),
          job.source_path,
          job.source_ref.trim(),
          job.status,
          job.retries,
          job.max_retries,
          job.error,
          job.error_code,
          job.error_message,
          job.missing_dependency,
          job.remediation,
          job.result_summary,
        ],
      );
      if (!row) throw new Error("create ingest job: no row returned");
      Object.assign(job, scanJob(row));
    },

    async getIngestJobBySourceRef(sourceRef: string, inputType: string): Promise<IngestJob | null> {
      const ref = sourceRef.trim();
      const type = inputType.trim();
      if (!ref || !type) return null;
      const row = await queryOne(
        pool,
        `SELECT ${JOB_COLUMNS} FROM ingest_jobs
         WHERE source_ref = $1 AND input_type = $2
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [ref, type],
      );
      return row ? scanJob(row) : null;
    },

    async getIngestJob(id: string): Promise<IngestJob | null> {
      const row = await queryOne(pool, `SELECT ${JOB_COLUMNS} FROM ingest_jobs WHERE id = $1`, [id]);
      return row ? scanJob(row) : null;
    },

    async listIngestJobs(limit: number): Promise<IngestJob[]> {
      const effectiveLimit = limit <= 0 || limit > 500 ? 50 : limit;
      const rows = await queryRows(
        pool,
        `SELECT ${JOB_COLUMNS} FROM ingest_jobs
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        [effectiveLimit],
      );
      return rows.map(scanJob);
    },

    async updateIngestJobStatus(id: string, status: string): Promise<void> {
      const normalized = normalizeJobStatus(status);
      validateJobStatus(normalized);
      await exec(
        pool,
        `UPDATE ingest_jobs SET status = $1, updated_at = ${NOW_TEXT} WHERE id = $2`,
        [normalized, id],
      );
    },

    async updateIngestJobFailure(
      id: string,
      errorCode: string,
      message: string,
      missingDep: string,
      remediation: string,
    ): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_jobs SET
          status = 'failed',
          retries = retries + 1,
          error = $1,
          error_code = $2,
          error_message = $3,
          missing_dependency = $4,
          remediation = $5,
          updated_at = ${NOW_TEXT}
        WHERE id = $6`,
        [message, errorCode, message, missingDep, remediation, id],
      );
    },

    async markIngestJobSucceeded(id: string, summary: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_jobs SET status='succeeded', result_summary=$2,
          runner_id='', heartbeat_at='', updated_at=(${NOW_TEXT})
        WHERE id=$1`,
        [id, summary],
      );
    },

    async resetIngestJobToQueued(id: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_jobs SET status='queued', error='', error_code='', error_message='',
          missing_dependency='', remediation='', result_summary='',
          runner_id='', heartbeat_at='', updated_at=(${NOW_TEXT})
        WHERE id=$1 AND status='running'`,
        [id],
      );
    },

    async deleteIngestJob(id: string): Promise<void> {
      await exec(pool, "DELETE FROM ingest_jobs WHERE id=$1", [id]);
    },

    async getJobLineage(id: string): Promise<IngestJob[]> {
      const rows = await queryRows(
        pool,
        `WITH RECURSIVE lineage AS (
          SELECT j.*, 0 AS depth FROM ingest_jobs j WHERE j.id = $1
          UNION ALL
          SELECT j.*, l.depth + 1 FROM ingest_jobs j
          JOIN lineage l ON j.id = l.parent_job_id
          WHERE l.depth < 63
        )
        SELECT ${JOB_COLUMNS}
        FROM lineage
        ORDER BY depth DESC`,
        [id],
      );
      return rows.map(scanJob);
    },

    async cancelIngestJob(id: string): Promise<boolean> {
      const affected = await exec(
        pool,
        `UPDATE ingest_jobs SET status = 'cancelled', updated_at = ${NOW_TEXT}
         WHERE id = $1 AND status IN ('queued', 'pending')`,
        [id],
      );
      return affected > 0;
    },

    async retryIngestJob(id: string): Promise<IngestJob | null> {
      const original = await this.getIngestJob(id);
      if (!original) return null;
      if (original.status !== "failed" && original.status !== "cancelled") {
        throw new Error("only failed and cancelled jobs can be retried");
      }

      const affected = await exec(
        pool,
        `UPDATE ingest_jobs SET
          status = 'queued',
          error = '', error_code = '', error_message = '',
          missing_dependency = '', remediation = '', result_summary = '',
          runner_id = '', heartbeat_at = '',
          retries = retries + 1,
          updated_at = ${NOW_TEXT}
        WHERE id = $1 AND status IN ('failed', 'cancelled')`,
        [id],
      );
      if (affected === 0) throw new Error("only failed and cancelled jobs can be retried");
      return this.getIngestJob(id);
    },

    async claimNextIngestJob(runnerID: string): Promise<IngestJob | null> {
      const maxConcurrent = await concurrencyLimit(pool);
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('llmwiki:ingest_jobs:claim'))");
        await client.query(RECOVER_STALE_SQL);

        const activeRow = await queryOne<[number]>(
          client,
          `SELECT COUNT(*) FROM ingest_jobs
           WHERE status = 'running'
           AND heartbeat_at != ''
           AND heartbeat_at >= ${STALE_CUTOFF}`,
        );
        const active = activeRow ? asNumber(activeRow[0]) : 0;
        if (active >= maxConcurrent) return null;

        const row = await queryOne(
          client,
          `UPDATE ingest_jobs
           SET status = 'running', runner_id = $1,
             heartbeat_at = ${NOW_TEXT}, updated_at = ${NOW_TEXT}
           WHERE id = (
             SELECT id FROM ingest_jobs
             WHERE status = 'queued'
             ORDER BY created_at ASC, id ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           RETURNING ${JOB_COLUMNS}`,
          [runnerID],
        );
        return row ? scanJob(row) : null;
      });
    },

    async touchIngestJobHeartbeat(jobID: string, runnerID: string): Promise<void> {
      await exec(
        pool,
        `UPDATE ingest_jobs SET heartbeat_at = ${NOW_TEXT}
         WHERE id = $1 AND status = 'running' AND runner_id = $2`,
        [jobID, runnerID],
      );
    },

    async clearIngestJobLease(jobID: string): Promise<void> {
      try {
        await exec(
          pool,
          `UPDATE ingest_jobs SET runner_id = '', heartbeat_at = '' WHERE id = $1`,
          [jobID],
        );
      } catch {
        // best-effort lease cleanup, matching the Go implementation
      }
    },

    async recoverStaleRunningJobs(): Promise<string[]> {
      const rows = await queryRows<[string]>(pool, `${RECOVER_STALE_SQL} RETURNING id`);
      return rows.map((row) => asString(row[0]));
    },

    async insertIngestJobEvent(
      jobID: string,
      step: string,
      phase: string,
      message: string,
      payload: Record<string, unknown>,
      maxPerJob: number,
    ): Promise<void> {
      const limit = maxPerJob > 0 ? maxPerJob : DEFAULT_JOB_EVENTS_MAX_COUNT;
      const payloadJSON = payload ? JSON.stringify(payload) : "";
      await exec(
        pool,
        `INSERT INTO ingest_job_events (job_id, step, phase, message, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, ${NOW_TEXT})`,
        [jobID, step, phase, message, payloadJSON],
      );
      await trimIngestJobEvents(jobID, limit);
    },

    async listIngestJobEvents(jobID: string, limit: number) {
      const effectiveLimit = limit <= 0 || limit > 500 ? 500 : limit;
      const rows = await queryRows(
        pool,
        `SELECT id, job_id, step, phase, COALESCE(message, ''), COALESCE(payload, ''), COALESCE(created_at, '')
         FROM ingest_job_events
         WHERE job_id = $1
         ORDER BY id ASC
         LIMIT $2`,
        [jobID, effectiveLimit],
      );
      return rows.map((row) => ({
        id: asNumber(row[0]),
        job_id: asString(row[1]),
        step: asString(row[2]),
        phase: asString(row[3]),
        message: asString(row[4]),
        payload: asString(row[5]),
        created_at: asString(row[6]),
      }));
    },

    async trimIngestJobEvents(jobID: string, maxCount: number): Promise<void> {
      await trimIngestJobEvents(jobID, maxCount);
    },

    async trimAllIngestJobEvents(maxCount: number): Promise<void> {
      const rows = await queryRows<[string]>(
        pool,
        "SELECT DISTINCT job_id FROM ingest_job_events",
      );
      for (const row of rows) {
        await trimIngestJobEvents(asString(row[0]), maxCount);
      }
    },

    async getJobEventsMaxCount(): Promise<number> {
      return clampJobEventsMaxCount(await ingestConfigValue(pool, "ingest_job_events_max_count"));
    },
  };
}
