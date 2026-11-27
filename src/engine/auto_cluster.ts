import path from "node:path";
import type { StructureMigrationEntry } from "../cli/migrate_structure.js";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { folderPathFromWikiRelPath, isCanonicalSlugSegment, isFolderOverviewPath, isWikiSystemPath } from "./wiki_org.js";

export interface OvercrowdedFolderInfo {
  kind: "wiki" | "archive";
  path: string;
  direct_count: number;
  threshold: number;
}

export interface ClusterFolderMeta {
  path: string;
  display_name: string;
  description: string;
  sort_order: number;
}

export interface ClusterPlanResult {
  folder: string;
  total_docs: number;
  clusters: ClusterFolderMeta[];
  entries: StructureMigrationEntry[];
  unassigned: string[];
}

export async function detectOvercrowdedFolders(
  db: Store,
  options: { wikiThreshold?: number; archiveThreshold?: number } = {},
): Promise<OvercrowdedFolderInfo[]> {
  const wikiThreshold = options.wikiThreshold ?? 20;
  const archiveThreshold = options.archiveThreshold ?? 30;
  const result: OvercrowdedFolderInfo[] = [];

  if (typeof db.listFolders === "function") {
    const folders = await db.listFolders(true);
    for (const f of folders) {
      if (f.direct_count > wikiThreshold) {
        result.push({
          kind: "wiki",
          path: f.path,
          direct_count: f.direct_count,
          threshold: wikiThreshold,
        });
      }
    }
  }

  if (typeof db.listArchiveFolders === "function") {
    const afolders = await db.listArchiveFolders();
    for (const f of afolders) {
      if (f.direct_count > archiveThreshold) {
        result.push({
          kind: "archive",
          path: f.path,
          direct_count: f.direct_count,
          threshold: archiveThreshold,
        });
      }
    }
  }

  return result.sort((a, b) => b.direct_count - a.direct_count);
}

function toKebabSlug(raw: string): string {
  const ascii = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "misc-group";
}

function extractClusterKey(doc: Document): { key: string; label: string } {
  const tags = (doc.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length > 0) {
    const tag = tags[0]!;
    return { key: toKebabSlug(tag), label: tag };
  }
  const title = (doc.title || doc.filename.replace(/\.md$/i, "")).trim();
  const lead = title.split(/[\s_\-（(：:]+/)[0] ?? "";
  const slug = toKebabSlug(lead);
  if (lead && isCanonicalSlugSegment(slug)) {
    return { key: slug, label: lead };
  }
  return { key: "general", label: "通用" };
}

/**
 * Deterministic fanout clustering: groups direct documents under `folderPath`
 * by primary tag or leading subject token, creating 3-6 subfolders for clusters
 * with >= `minClusterSize` pages (capped at depth 3).
 */
export function buildDeterministicClusterPlan(
  docs: Document[],
  folderPath: string,
  options: { minClusterSize?: number; maxClusters?: number; batch?: string } = {},
): ClusterPlanResult {
  const cleanFolder = folderPath.trim().replace(/^\/+|\/+$/g, "").replace(/^wiki\//, "");
  const depth = cleanFolder ? cleanFolder.split("/").length : 0;
  if (depth >= 3) {
    return { folder: cleanFolder, total_docs: 0, clusters: [], entries: [], unassigned: [] };
  }

  const minClusterSize = options.minClusterSize ?? 3;
  const maxClusters = options.maxClusters ?? 6;
  const batch = options.batch ?? `auto-cluster-${cleanFolder.replace(/\//g, "-")}`;

  const directDocs = docs.filter(
    (d) =>
      d.source_kind === "wiki" &&
      !d.archived_at &&
      !d.deleted_at &&
      !isWikiSystemPath(d.relative_path) &&
      !isFolderOverviewPath(d.relative_path) &&
      folderPathFromWikiRelPath(d.relative_path) === cleanFolder,
  );

  const buckets = new Map<string, { label: string; docs: Document[] }>();
  for (const doc of directDocs) {
    const { key, label } = extractClusterKey(doc);
    const existing = buckets.get(key) ?? { label, docs: [] };
    existing.docs.push(doc);
    buckets.set(key, existing);
  }

  const eligible = [...buckets.entries()]
    .filter(([, group]) => group.docs.length >= minClusterSize)
    .sort((a, b) => b[1].docs.length - a[1].docs.length)
    .slice(0, maxClusters);

  const clusters: ClusterFolderMeta[] = [];
  const entries: StructureMigrationEntry[] = [];
  const assignedIds = new Set<string>();

  eligible.forEach(([slug, group], idx) => {
    const targetFolder = cleanFolder ? `${cleanFolder}/${slug}` : slug;
    clusters.push({
      path: targetFolder,
      display_name: group.label,
      description: `自动聚类子组：收录 ${group.label} 相关主题页面（${group.docs.length} 页）。`,
      sort_order: (idx + 1) * 10,
    });
    for (const doc of group.docs) {
      assignedIds.add(doc.id);
      const filename = path.posix.basename(doc.relative_path);
      entries.push({
        batch,
        document_id: doc.id,
        old_path: doc.relative_path,
        new_path: `wiki/${targetFolder}/${filename}`,
        old_type: doc.page_type || "concept",
        new_type: doc.page_type || "concept",
        action: "move",
        rationale: `按主题聚类归入 ${targetFolder}（${group.label}）`,
        confidence: "medium",
        status: "pending",
        ...(doc.content_hash ? { content_hash: doc.content_hash } : {}),
      });
    }
  });

  const unassigned = directDocs
    .filter((d) => !assignedIds.has(d.id))
    .map((d) => d.relative_path);

  return {
    folder: cleanFolder,
    total_docs: directDocs.length,
    clusters,
    entries,
    unassigned,
  };
}
