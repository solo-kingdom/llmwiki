import { getMetadataJSON, parseFrontmatter } from "../../engine/frontmatter.js";
import type { Document } from "../types.js";

/** Parse a JSON-encoded string array column safely. */
export function parseStringArrayJson(raw: string): string[] {
  if (!raw || raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Serialize a string array to JSON for DB storage. */
export function stringArrayJson(values: string[] | undefined): string {
  return values && values.length > 0 ? JSON.stringify(values) : "[]";
}

/** Synchronize wiki-data metadata fields on a Document from its markdown frontmatter. */
export function syncDocumentMetaFromContent(doc: Document): void {
  if (doc.source_kind !== "wiki" || !doc.content) return;
  const fm = parseFrontmatter(doc.content);
  if (!fm.title && !fm.type && !fm.date && !fm.confidence && !fm.archived_at) return;

  if (fm.title) doc.title = fm.title;
  if (fm.date) doc.date = fm.date;
  if (fm.tags.length > 0) doc.tags = fm.tags;
  const metaJson = getMetadataJSON(fm);
  if (metaJson !== "{}") doc.metadata = metaJson;

  doc.confidence = fm.confidence ?? "";
  doc.page_status = fm.status ?? "";
  doc.experience_kind = fm.kind ?? "";
  doc.last_verified = fm.last_verified ?? "";
  doc.review_after = fm.review_after ?? "";
  doc.archived_at = fm.archived_at ?? "";
  doc.archive_reason = fm.archive_reason ?? "";
  doc.superseded_by = fm.superseded_by ?? "";
  doc.aliases = fm.aliases ?? [];
  doc.symptoms = fm.symptoms ?? [];
}

/** Return today's date in YYYY-MM-DD (UTC). */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
