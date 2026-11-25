import type { Document } from "../store/types.js";
import { syncDocumentMetaFromContent, todayIsoDate } from "../store/postgres/doc_meta.js";
import {
  appendArchiveHistoryEntry,
  isValidIsoDate,
  upsertFrontmatterFields,
} from "./frontmatter.js";
import { isValidConfidence } from "./wiki_org.js";

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveValidationError";
  }
}

export interface ArchiveOptions {
  reason: string;
  supersededBy?: string;
  date?: string;
}

export interface ReopenOptions {
  reason?: string;
  confidence?: string;
  lastVerified?: string;
  reviewAfter?: string;
  date?: string;
}

/** Build updated Document for in-place archiving (preserves path, ID, chunks, and links). */
export function buildArchivedDocument(doc: Document, opts: ArchiveOptions): Document {
  const reason = opts.reason.trim();
  if (!reason) {
    throw new ArchiveValidationError("archive reason is required");
  }
  const archiveDate = (opts.date ?? "").trim() || todayIsoDate();
  if (!isValidIsoDate(archiveDate)) {
    throw new ArchiveValidationError(`invalid archive date: ${archiveDate}`);
  }
  const supersededBy = (opts.supersededBy ?? "").trim();

  const updates: Record<string, string> = {
    archived_at: archiveDate,
    archive_reason: reason,
    date: archiveDate,
  };
  const removals: string[] = [];
  if (supersededBy) {
    updates.superseded_by = supersededBy;
  } else {
    removals.push("superseded_by");
  }

  let nextContent = upsertFrontmatterFields(doc.content ?? "", updates, removals);
  const note = supersededBy
    ? `- [${archiveDate}] 归档：${reason}（替代页：${supersededBy}）`
    : `- [${archiveDate}] 归档：${reason}`;
  nextContent = appendArchiveHistoryEntry(nextContent, note);

  const next: Document = {
    ...doc,
    content: nextContent,
    date: archiveDate,
    archived_at: archiveDate,
    archive_reason: reason,
    superseded_by: supersededBy,
  };
  syncDocumentMetaFromContent(next);
  return next;
}

/** Build updated Document for reopening an in-place archived page. */
export function buildReopenedDocument(doc: Document, opts: ReopenOptions): Document {
  if (!doc.archived_at) {
    throw new ArchiveValidationError("document is not archived");
  }
  const reopenDate = (opts.date ?? "").trim() || todayIsoDate();
  if (!isValidIsoDate(reopenDate)) {
    throw new ArchiveValidationError(`invalid reopen date: ${reopenDate}`);
  }
  const confidence = (opts.confidence ?? "").trim().toLowerCase();
  if (confidence && !isValidConfidence(confidence)) {
    throw new ArchiveValidationError(`invalid confidence: ${confidence}`);
  }
  const lastVerified = (opts.lastVerified ?? "").trim();
  if (lastVerified && !isValidIsoDate(lastVerified)) {
    throw new ArchiveValidationError(`invalid last_verified date: ${lastVerified}`);
  }
  const reviewAfter = (opts.reviewAfter ?? "").trim();
  if (reviewAfter && !isValidIsoDate(reviewAfter)) {
    throw new ArchiveValidationError(`invalid review_after date: ${reviewAfter}`);
  }

  const updates: Record<string, string> = { date: reopenDate };
  if (confidence) updates.confidence = confidence;
  if (lastVerified) updates.last_verified = lastVerified;
  if (reviewAfter) updates.review_after = reviewAfter;

  let nextContent = upsertFrontmatterFields(doc.content ?? "", updates, [
    "archived_at",
    "archive_reason",
    "superseded_by",
  ]);
  const reason = (opts.reason ?? "").trim() || "重新启用";
  nextContent = appendArchiveHistoryEntry(nextContent, `- [${reopenDate}] 重开：${reason}`);

  const next: Document = {
    ...doc,
    content: nextContent,
    date: reopenDate,
    archived_at: "",
    archive_reason: "",
    superseded_by: "",
    ...(confidence ? { confidence } : {}),
    ...(lastVerified ? { last_verified: lastVerified } : {}),
    ...(reviewAfter ? { review_after: reviewAfter } : {}),
  };
  syncDocumentMetaFromContent(next);
  return next;
}
