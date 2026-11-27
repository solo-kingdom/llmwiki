import { readFile } from "node:fs/promises";
import { isValidPageType, validateWikiWritePath } from "../engine/wiki_org.js";
import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import { openCliStore } from "./workspace.js";

export type StructureMigrationAction = "move" | "retype" | "merge";

export interface StructureMigrationEntry {
  batch: string;
  document_id: string;
  old_path: string;
  new_path: string;
  old_type: string;
  new_type: string;
  action: StructureMigrationAction;
  rationale: string;
  confidence: "high" | "medium" | "low";
  status: string;
  content_hash?: string;
  merge_into_document_id?: string;
}

export interface StructureMigrationIssue {
  code: string;
  path: string;
  message: string;
}

export interface StructureMigrationReport {
  valid: boolean;
  dry_run: true;
  stats: {
    entries: number;
    batches: number;
    move: number;
    retype: number;
    merge: number;
  };
  issues: StructureMigrationIssue[];
}

export function parseStructureMigrationManifest(raw: string): StructureMigrationEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`migration manifest is invalid JSON: ${errorMessage(error)}`);
  }
  const entries = Array.isArray(value) ? value : (value as { entries?: unknown })?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("migration manifest must be a non-empty array or {entries:[...]} object");
  }
  return entries.map((entry, index) => parseEntry(entry, index));
}

export async function dryRunStructureMigration(
  db: Store,
  entries: StructureMigrationEntry[],
): Promise<StructureMigrationReport> {
  const docs = await db.listDocumentsWithContent();
  const byID = new Map(docs.map((doc) => [doc.id, doc]));
  const byPath = new Map(docs.map((doc) => [doc.relative_path, doc]));
  const issues: StructureMigrationIssue[] = [];
  const sourceIDs = new Set<string>();
  const targetPaths = new Map<string, StructureMigrationEntry[]>();
  const stats = {
    entries: entries.length,
    batches: new Set(entries.map((entry) => entry.batch)).size,
    move: entries.filter((entry) => entry.action === "move").length,
    retype: entries.filter((entry) => entry.action === "retype").length,
    merge: entries.filter((entry) => entry.action === "merge").length,
  };

  for (const entry of entries) {
    if (sourceIDs.has(entry.document_id)) {
      issue(issues, "duplicate_source", entry.old_path, `document_id 在 manifest 中重复: ${entry.document_id}`);
    }
    sourceIDs.add(entry.document_id);
    const targets = targetPaths.get(entry.new_path) ?? [];
    targets.push(entry);
    targetPaths.set(entry.new_path, targets);
    if (entry.status !== "pending") {
      issue(issues, "entry_not_pending", entry.old_path, `只允许 dry-run pending 条目，当前 status=${entry.status}`);
    }

    const source = byID.get(entry.document_id);
    const oldPathDoc = byPath.get(entry.old_path);
    if (!source || source.relative_path !== entry.old_path) {
      issue(issues, "source_mismatch", entry.old_path, `document_id 与 old_path 不匹配: ${entry.document_id}`);
    }
    const current = source ?? oldPathDoc;
    if (current) {
      if (current.page_type !== entry.old_type) {
        issue(issues, "type_mismatch", entry.old_path, `old_type=${entry.old_type}，实际为 ${current.page_type || "(empty)"}`);
      }
      if (entry.content_hash && current.content_hash !== entry.content_hash) {
        issue(issues, "content_hash_mismatch", entry.old_path, "content_hash 已变化，请重新生成 manifest");
      }
      if (current.archived_at || current.deleted_at) {
        issue(issues, "source_archived", entry.old_path, "只允许迁移活跃页面");
      }
    }
    try {
      validateWikiWritePath(entry.new_path);
    } catch (error) {
      issue(issues, "invalid_target", entry.new_path, errorMessage(error));
    }

    const target = byPath.get(entry.new_path);
    if (entry.action === "merge") {
      const mergeTarget = byID.get(entry.merge_into_document_id ?? "");
      if (!mergeTarget) {
        issue(issues, "merge_target_missing", entry.old_path, "merge_into_document_id 必须指向已有 canonical 页面");
      } else if (mergeTarget.relative_path !== entry.new_path) {
        issue(issues, "merge_target_path", entry.new_path, `new_path 必须等于 merge target 路径: ${mergeTarget.relative_path}`);
      }
      if (mergeTarget?.id === entry.document_id) {
        issue(issues, "merge_target_missing", entry.old_path, "merge target 不能与 source 相同");
      }
    } else if (target && target.id !== entry.document_id && !sourceIDsHasPath(entries, target.relative_path)) {
      issue(issues, "target_conflict", entry.new_path, `目标路径已被 ${target.id} 占用`);
    }
  }

  for (const [targetPath, targetEntries] of targetPaths) {
    if (targetEntries.length > 1 && targetEntries.some((entry) => entry.action !== "merge")) {
      for (const entry of targetEntries) {
        issue(issues, "duplicate_target", targetPath, "多个非 merge 条目指向同一 new_path");
      }
    }
  }

  return { valid: issues.length === 0, dry_run: true, stats, issues };
}

export async function runMigrateStructure(
  options: { manifest?: string; dryRun?: boolean },
  databaseUrl?: string,
): Promise<void> {
  if (!options.manifest) throw new Error("--manifest is required");
  if (!options.dryRun) throw new Error("migrate-structure currently supports only --dry-run; no write mode is available");
  const manifest = parseStructureMigrationManifest(await readFile(options.manifest, "utf8"));
  const store = await openCliStore(databaseUrl);
  try {
    const report = await dryRunStructureMigration(store, manifest);
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) throw new Error(`structure migration dry-run failed with ${report.issues.length} issue(s)`);
  } finally {
    await store.close();
  }
}

function parseEntry(value: unknown, index: number): StructureMigrationEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`migration entries[${index}] must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const required = ["batch", "document_id", "old_path", "new_path", "old_type", "new_type", "action", "rationale", "confidence", "status"];
  for (const key of required) {
    if (typeof raw[key] !== "string" || !raw[key].trim()) {
      throw new Error(`migration entries[${index}].${key} is required`);
    }
  }
  const action = stringValue(raw.action);
  if (action !== "move" && action !== "retype" && action !== "merge") {
    throw new Error(`migration entries[${index}].action must be move, retype, or merge`);
  }
  const oldType = stringValue(raw.old_type).toLowerCase();
  const newType = stringValue(raw.new_type).toLowerCase();
  if (!isValidPageType(oldType) || !isValidPageType(newType) || newType === "page") {
    throw new Error(`migration entries[${index}] has invalid old_type/new_type`);
  }
  const confidence = stringValue(raw.confidence).toLowerCase();
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    throw new Error(`migration entries[${index}].confidence must be high, medium, or low`);
  }
  return {
    batch: stringValue(raw.batch),
    document_id: stringValue(raw.document_id),
    old_path: stringValue(raw.old_path),
    new_path: stringValue(raw.new_path),
    old_type: oldType,
    new_type: newType,
    action,
    rationale: stringValue(raw.rationale),
    confidence,
    status: stringValue(raw.status),
    ...(stringValue(raw.content_hash) ? { content_hash: stringValue(raw.content_hash) } : {}),
    ...(stringValue(raw.merge_into_document_id) ? { merge_into_document_id: stringValue(raw.merge_into_document_id) } : {}),
  };
}

function sourceIDsHasPath(entries: StructureMigrationEntry[], relativePath: string): boolean {
  return entries.some((entry) => entry.old_path === relativePath && entry.action !== "merge");
}

function issue(issues: StructureMigrationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
