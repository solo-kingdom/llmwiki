import type { IngestJob } from "./types.js";

export const INGEST_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

export const JOB_LIST_DEFAULT_LIMIT = 50;
export const JOB_LIST_MAX_LIMIT = 100;

const STATUS_SET = new Set<string>(INGEST_JOB_STATUSES);

export interface IngestJobListFilter {
  statuses: string[];
  inputType: string;
  query: string;
  limit: number;
  offset: number;
}

export interface IngestJobStatusCounts {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

export interface IngestJobListResult {
  jobs: IngestJob[];
  total: number;
  counts: IngestJobStatusCounts;
}

export function emptyIngestJobStatusCounts(): IngestJobStatusCounts {
  return { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
}

export function clampJobListLimit(limit: number): number {
  if (!Number.isFinite(limit)) return JOB_LIST_DEFAULT_LIMIT;
  const value = Math.trunc(limit);
  if (value < 1) return 1;
  if (value > JOB_LIST_MAX_LIMIT) return JOB_LIST_MAX_LIMIT;
  return value;
}

export function clampJobListOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

/** Comma-separated status list. Empty means no status filter. Unknown tokens throw. */
export function parseJobStatusFilter(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const statuses = [
    ...new Set(
      trimmed
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part !== ""),
    ),
  ];
  for (const status of statuses) {
    if (!STATUS_SET.has(status)) throw new Error(`invalid status: ${status}`);
  }
  return statuses;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function buildIngestJobListWhere(
  filter: Pick<IngestJobListFilter, "statuses" | "inputType" | "query">,
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (filter.statuses.length > 0) {
    params.push(filter.statuses);
    parts.push(`status = ANY($${params.length}::text[])`);
  }
  const inputType = filter.inputType.trim();
  if (inputType !== "") {
    params.push(inputType);
    parts.push(`input_type = $${params.length}`);
  }
  const query = filter.query.trim();
  if (query !== "") {
    params.push(`%${escapeLikePattern(query)}%`);
    const index = params.length;
    parts.push(
      `(id ILIKE $${index} ESCAPE '\\' OR source_path ILIKE $${index} ESCAPE '\\' OR source_ref ILIKE $${index} ESCAPE '\\')`,
    );
  }
  return { clause: parts.length === 0 ? "" : `WHERE ${parts.join(" AND ")}`, params };
}
