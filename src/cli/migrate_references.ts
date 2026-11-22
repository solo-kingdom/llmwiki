import { extractTrailingReferences, type ExtractedReferenceEntry } from "../engine/ref_sections.js";
import { buildPageChunks, rebuildReferences, storeReferenceEntries } from "../ingest/dbapply.js";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { openCliStore } from "./workspace.js";

interface MigrationStats {
  scanned: number;
  changed: number;
  entries: number;
  unresolved: number;
  skippedHeadings: string[];
}

/** One-off migration: extract trailing reference sections from every stored
 * wiki page into document_reference_entries and strip them from content.
 * Idempotent — pages already stripped produce no changes. */
export async function runMigrateReferences(
  options: { dryRun?: boolean } | undefined,
  databaseUrl?: string,
): Promise<void> {
  const dryRun = options?.dryRun ?? false;
  const store = await openCliStore(databaseUrl);
  try {
    const docs = (await store.listDocumentsWithContent()).filter(
      (doc) => doc.source_kind === "wiki" && doc.content,
    );
    const stats: MigrationStats = {
      scanned: docs.length,
      changed: 0,
      entries: 0,
      unresolved: 0,
      skippedHeadings: [],
    };

    const pending: { doc: Document; entries: ExtractedReferenceEntry[]; content: string }[] = [];
    for (const doc of docs) {
      const norm = extractTrailingReferences(doc.content ?? "");
      stats.skippedHeadings.push(...norm.skippedHeadings);
      if (norm.entries.length === 0 && norm.content === doc.content) continue;
      stats.changed += 1;
      stats.entries += norm.entries.length;
      pending.push({ doc, entries: norm.entries, content: norm.content });
      if (dryRun) {
        const related = norm.entries.filter((e) => e.kind === "related").length;
        const source = norm.entries.filter((e) => e.kind === "source").length;
        console.log(
          `[dry-run] ${doc.relative_path}: strip sections, related=${related} source=${source}` +
            (norm.skippedHeadings.length > 0 ? ` skipped=[${norm.skippedHeadings.join(", ")}]` : ""),
        );
      }
    }

    if (dryRun) {
      console.log(
        `[dry-run] scanned=${stats.scanned} would-change=${stats.changed} entries=${stats.entries}`,
      );
      if (stats.skippedHeadings.length > 0) {
        console.log(
          `[dry-run] reference-like sections kept in place (non-bullet content): ${[...new Set(stats.skippedHeadings)].join(", ")}`,
        );
      }
      return;
    }

    const extracted = new Map<string, ExtractedReferenceEntry[]>();
    for (const item of pending) {
      await store.updateDocument(
        item.doc.id,
        item.content,
        item.doc.title ?? "",
        item.doc.tags ?? [],
        item.doc.date ?? "",
        item.doc.metadata ?? "",
      );
      await store.storeChunks(item.doc.id, buildPageChunks(item.doc.id, item.content));
      extracted.set(item.doc.relative_path, item.entries);
    }
    await storeReferenceEntries(store, extracted);
    await rebuildReferences(store, [...extracted.keys()]);

    // Count unresolved targets after resolution.
    stats.unresolved = 0;
    for (const item of pending) {
      const entries = await store.listReferenceEntries(item.doc.id);
      stats.unresolved += entries.filter((entry) => !entry.targetDocumentId).length;
    }

    console.log(
      `Migrated references: scanned=${stats.scanned} changed=${stats.changed} entries=${stats.entries} unresolved-targets=${stats.unresolved}`,
    );
    if (stats.skippedHeadings.length > 0) {
      console.log(
        `Reference-like sections kept in place (non-bullet content): ${[...new Set(stats.skippedHeadings)].join(", ")}`,
      );
    }
  } finally {
    await store.close();
  }
}
