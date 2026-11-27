import { randomUUID } from "node:crypto";
import type { Store } from "../store/interfaces.js";
import type { Document, PageWrite } from "../store/types.js";
import { openCliStore } from "./workspace.js";

const LEGACY_EXACT_PATHS = new Set(["wiki/log.md", "wiki/index.md"]);

export function isLegacySystemPagePath(relativePath: string): boolean {
  const normalized = relativePath.trim().replace(/^\/+/, "");
  return LEGACY_EXACT_PATHS.has(normalized) || normalized.startsWith("wiki/templates/");
}

export interface CleanupLegacyResult {
  dryRun: boolean;
  candidates: Array<{ id: string; relative_path: string; title: string }>;
  deletedCount: number;
  changeSetId: string;
}

export async function cleanupLegacySystemPages(
  store: Store,
  apply: boolean,
): Promise<CleanupLegacyResult> {
  const docs = await store.listDocumentsFiltered({ archived: "include" });
  const matches: Document[] = docs.filter((doc) => isLegacySystemPagePath(doc.relative_path));
  const candidates = matches.map((doc) => ({
    id: doc.id,
    relative_path: doc.relative_path,
    title: doc.title,
  }));

  if (!apply || matches.length === 0) {
    return {
      dryRun: !apply,
      candidates,
      deletedCount: 0,
      changeSetId: "",
    };
  }

  const changeSetId = randomUUID();
  const writes: PageWrite[] = matches.map((doc) => ({
    relative_path: doc.relative_path,
    document: null,
    operation: "delete",
    chunks: [],
    refs: [],
  }));
  await store.applyChangeSet(
    {
      id: changeSetId,
      kind: "delete",
      summary: `cleanup ${matches.length} legacy system page(s)`,
      page_count: writes.length,
      created_at: "",
    },
    writes,
  );
  return {
    dryRun: false,
    candidates,
    deletedCount: writes.length,
    changeSetId,
  };
}

export async function runCleanupLegacy(
  opts: { dryRun?: boolean; apply?: boolean },
  databaseUrl?: string,
): Promise<void> {
  const apply = Boolean(opts.apply);
  const store = await openCliStore(databaseUrl);
  try {
    const result = await cleanupLegacySystemPages(store, apply);
    if (result.candidates.length === 0) {
      console.log("No legacy system pages (wiki/log.md, wiki/index.md, wiki/templates/*) found.");
      return;
    }
    for (const item of result.candidates) {
      console.log(`${apply ? "[DELETE]" : "[DRY-RUN]"} ${item.relative_path} (${item.id})`);
    }
    if (apply) {
      console.log(`Deleted ${result.deletedCount} legacy system page(s) (change_set: ${result.changeSetId}).`);
    } else {
      console.log(`Found ${result.candidates.length} legacy system page(s). Re-run with --apply to delete.`);
    }
  } finally {
    await store.close();
  }
}
