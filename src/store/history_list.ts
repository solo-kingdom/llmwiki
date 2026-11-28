import type { ChangeSet } from "./types.js";

export const CHANGE_SET_KINDS = [
  "ingest",
  "review_apply",
  "rollback",
  "manual",
  "delete",
  "import",
] as const;

export type ChangeSetKind = (typeof CHANGE_SET_KINDS)[number];

export const HISTORY_LIST_DEFAULT_LIMIT = 50;
export const HISTORY_LIST_MAX_LIMIT = 200;

const KIND_SET = new Set<string>(CHANGE_SET_KINDS);

export interface ChangeSetListFilter {
  kinds: string[];
  query: string;
  from: string;
  to: string;
  before: string;
  limit: number;
  offset: number;
}

export interface ChangeSetKindCounts {
  ingest: number;
  review_apply: number;
  rollback: number;
  manual: number;
  delete: number;
  import: number;
}

export interface ChangeSetListResult {
  changes: ChangeSet[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  counts: ChangeSetKindCounts;
}

export function emptyChangeSetKindCounts(): ChangeSetKindCounts {
  return {
    ingest: 0,
    review_apply: 0,
    rollback: 0,
    manual: 0,
    delete: 0,
    import: 0,
  };
}

export function isListedChangeSetKind(kind: string): kind is ChangeSetKind {
  return KIND_SET.has(kind);
}

export function clampHistoryListLimit(limit: number): number {
  if (!Number.isFinite(limit)) return HISTORY_LIST_DEFAULT_LIMIT;
  const value = Math.trunc(limit);
  if (value < 1) return 1;
  if (value > HISTORY_LIST_MAX_LIMIT) return HISTORY_LIST_MAX_LIMIT;
  return value;
}

export function clampHistoryListOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

/** Comma-separated kind list. Empty means no kind filter. Unknown tokens throw. */
export function parseHistoryKindFilter(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const kinds = [
    ...new Set(
      trimmed
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part !== ""),
    ),
  ];
  for (const kind of kinds) {
    if (!KIND_SET.has(kind)) throw new Error(`invalid kind: ${kind}`);
  }
  return kinds;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BARE_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const ISO_TZ_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function isValidTimeParts(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function formatUtcDbTimestamp(dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

/**
 * Normalizes a query timestamp (`from`, `to`, `before`) into DB UTC text (`YYYY-MM-DD HH:MM:SS`).
 * Date-only `YYYY-MM-DD` expands to start-of-day for `from`/`before` and end-of-day for `to`.
 */
export function parseHistoryTimeBound(raw: string, bound: "from" | "to" | "before"): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  const dateOnly = DATE_ONLY_RE.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!isValidCalendarDate(year, month, day)) {
      throw new Error(`invalid ${bound} timestamp: ${raw}`);
    }
    return bound === "to" ? `${trimmed} 23:59:59` : `${trimmed} 00:00:00`;
  }

  const bare = BARE_DATETIME_RE.exec(trimmed);
  if (bare) {
    const year = Number(bare[1]);
    const month = Number(bare[2]);
    const day = Number(bare[3]);
    const hour = Number(bare[4]);
    const minute = Number(bare[5]);
    const second = Number(bare[6]);
    if (!isValidCalendarDate(year, month, day) || !isValidTimeParts(hour, minute, second)) {
      throw new Error(`invalid ${bound} timestamp: ${raw}`);
    }
    return `${bare[1]}-${bare[2]}-${bare[3]} ${bare[4]}:${bare[5]}:${bare[6]}`;
  }

  const iso = ISO_TZ_RE.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const hour = Number(iso[4]);
    const minute = Number(iso[5]);
    const second = Number(iso[6]);
    if (!isValidCalendarDate(year, month, day) || !isValidTimeParts(hour, minute, second)) {
      throw new Error(`invalid ${bound} timestamp: ${raw}`);
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`invalid ${bound} timestamp: ${raw}`);
    }
    return formatUtcDbTimestamp(parsed);
  }

  throw new Error(`invalid ${bound} timestamp: ${raw}`);
}

export function validateHistoryTimeRange(from: string, to: string): void {
  if (from && to && from > to) {
    throw new Error("from must not be after to");
  }
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function buildChangeSetListWhere(
  filter: Pick<ChangeSetListFilter, "kinds" | "query" | "from" | "to" | "before">,
  options: { includeKinds?: boolean } = {},
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (options.includeKinds !== false && filter.kinds.length > 0) {
    params.push(filter.kinds);
    parts.push(`cs.kind = ANY($${params.length}::text[])`);
  }
  if (filter.before !== "") {
    params.push(filter.before);
    parts.push(`cs.created_at < $${params.length}`);
  }
  if (filter.from !== "") {
    params.push(filter.from);
    parts.push(`cs.created_at >= $${params.length}`);
  }
  if (filter.to !== "") {
    params.push(filter.to);
    parts.push(`cs.created_at <= $${params.length}`);
  }
  const query = filter.query.trim();
  if (query !== "") {
    params.push(`%${escapeLikePattern(query)}%`);
    const index = params.length;
    parts.push(
      `(cs.id ILIKE $${index} ESCAPE '\\' OR cs.summary ILIKE $${index} ESCAPE '\\' OR cs.source_filename ILIKE $${index} ESCAPE '\\' OR EXISTS (SELECT 1 FROM page_revisions pr WHERE pr.change_set_id = cs.id AND (pr.relative_path ILIKE $${index} ESCAPE '\\' OR pr.title ILIKE $${index} ESCAPE '\\')))`,
    );
  }

  return { clause: parts.length === 0 ? "" : `WHERE ${parts.join(" AND ")}`, params };
}
