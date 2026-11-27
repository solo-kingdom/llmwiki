import path from "node:path";
import type { Document } from "../store/types.js";
import { classifyWikiPath, isFolderOverviewPath, normalizeWikiRelPath, wikiSubdirFromPath } from "./wiki_org.js";

export class CanonicalPageConflictError extends Error {
  constructor(
    readonly candidatePath: string,
    readonly existing: Document,
  ) {
    super(`canonical page conflict: ${candidatePath} duplicates ${existing.relative_path} (${existing.id})`);
    this.name = "CanonicalPageConflictError";
  }
}

export function normalizeCanonicalPageName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[\s_\-]+/gu, "");
}

export function canonicalKeysForDocument(doc: Document): string[] {
  if (!isCanonicalBusinessDocument(doc)) return [];
  const values = [doc.title, path.posix.basename(doc.filename, path.posix.extname(doc.filename)), ...(doc.aliases ?? [])];
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = normalizeCanonicalPageName(value ?? "");
    if (normalized) keys.add(`name:${normalized}`);
  }
  return [...keys].sort();
}

export function canonicalPathLockKey(relativePath: string): string {
  const normalized = normalizeWikiRelPath(relativePath).normalize("NFKC").toLowerCase();
  return normalized ? `path:${normalized}` : "";
}

export function findCanonicalPageConflict(
  candidate: Document,
  existingDocuments: Document[],
): Document | null {
  const candidateKeys = new Set(canonicalKeysForDocument(candidate));
  if (candidateKeys.size === 0) return null;
  for (const existing of existingDocuments) {
    if (existing.id && candidate.id && existing.id === candidate.id) continue;
    if (normalizeWikiRelPath(existing.relative_path) === normalizeWikiRelPath(candidate.relative_path)) continue;
    if (canonicalKeysForDocument(existing).some((key) => candidateKeys.has(key))) return existing;
  }
  return null;
}

function isCanonicalBusinessDocument(doc: Document): boolean {
  if (doc.source_kind !== "wiki" || doc.deleted_at || doc.archived_at) return false;
  if (isFolderOverviewPath(doc.relative_path)) return false;
  if (classifyWikiPath(doc.relative_path) !== "typed_content") return false;
  return wikiSubdirFromPath(doc.relative_path).toLowerCase() !== "sources";
}
