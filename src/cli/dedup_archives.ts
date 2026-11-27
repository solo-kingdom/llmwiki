import path from "node:path";
import type { Store } from "../store/interfaces.js";
import type { ArchiveFile } from "../store/types.js";
import { openCliStore } from "./workspace.js";

export interface DedupArchiveGroup {
  sha256: string;
  keep_id: string;
  keep_path: string;
  canonical_filename: string;
  drop_ids: string[];
  drop_paths: string[];
}

export function stripDuplicateSuffix(filename: string): string {
  const ext = path.posix.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  const cleaned = stem.replace(/-\d+$/, "");
  return `${cleaned || stem}${ext}`;
}

export async function planArchiveDedup(db: Store): Promise<DedupArchiveGroup[]> {
  const files = await db.listArchiveFiles();
  const bySha = new Map<string, ArchiveFile[]>();
  const pathOwners = new Map<string, string>();
  for (const file of files) {
    pathOwners.set(`${file.folder_path}::${file.filename}`, file.sha256);
    if (!file.sha256) continue;
    const group = bySha.get(file.sha256) ?? [];
    group.push(file);
    bySha.set(file.sha256, group);
  }

  const groups: DedupArchiveGroup[] = [];
  for (const [sha256, items] of bySha) {
    if (items.length < 2) continue;
    const scored = await Promise.all(
      items.map(async (item) => {
        const docs = await db.listArchiveFileDocuments(item.id);
        return {
          item,
          linkCount: docs.length,
          hasJob: item.ingest_job_id ? 1 : 0,
        };
      }),
    );
    scored.sort((a, b) => {
      if (b.linkCount !== a.linkCount) return b.linkCount - a.linkCount;
      if (b.hasJob !== a.hasJob) return b.hasJob - a.hasJob;
      return a.item.created_at.localeCompare(b.item.created_at) || a.item.id.localeCompare(b.item.id);
    });

    const keeper = scored[0]!.item;
    const drops = scored.slice(1).map((s) => s.item);
    const candidateFilename = stripDuplicateSuffix(keeper.filename);
    const ownerSha = pathOwners.get(`${keeper.folder_path}::${candidateFilename}`);
    const canRename = !ownerSha || ownerSha === sha256;
    const canonicalFilename = canRename ? candidateFilename : keeper.filename;

    groups.push({
      sha256,
      keep_id: keeper.id,
      keep_path: keeper.relative_path,
      canonical_filename: canonicalFilename,
      drop_ids: drops.map((d) => d.id),
      drop_paths: drops.map((d) => d.relative_path),
    });
  }
  return groups;
}

export async function applyArchiveDedup(
  db: Store,
  groups: DedupArchiveGroup[],
): Promise<{ merged_groups: number; removed_files: number }> {
  if (typeof db.mergeDuplicateArchiveFiles !== "function") {
    throw new Error("store does not support mergeDuplicateArchiveFiles");
  }
  let removedFiles = 0;
  for (const group of groups) {
    await db.mergeDuplicateArchiveFiles(group.keep_id, group.drop_ids, {
      filename: group.canonical_filename,
    });
    removedFiles += group.drop_ids.length;
  }
  return { merged_groups: groups.length, removed_files: removedFiles };
}

export async function runDedupArchives(
  options: { dryRun?: boolean; apply?: boolean },
  databaseUrl?: string,
): Promise<void> {
  if (!options.dryRun && !options.apply) {
    throw new Error("specify either --dry-run or --apply");
  }
  if (options.dryRun && options.apply) {
    throw new Error("--dry-run and --apply are mutually exclusive");
  }
  const store = await openCliStore(databaseUrl);
  try {
    const groups = await planArchiveDedup(store);
    if (options.dryRun) {
      console.log(JSON.stringify({
        dry_run: true,
        duplicate_groups: groups.length,
        files_to_remove: groups.reduce((sum, g) => sum + g.drop_ids.length, 0),
        groups,
      }, null, 2));
      return;
    }
    const result = await applyArchiveDedup(store, groups);
    console.log(JSON.stringify({ dry_run: false, ...result }, null, 2));
  } finally {
    await store.close();
  }
}
