import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { IndexBuilder, INDEX_REL_PATH } from "./index_builder.js";
import { LOG_REL_PATH } from "./log_validator.js";

export interface WikiFileIndexer {
  indexFile(relPath: string): Promise<void>;
}

export interface PostApplyMaintenanceOptions {
  writtenPaths: string[];
  deletedPaths: string[];
  sessionMode: string;
  planSummary: string;
  moveCount: number;
  mergeCount: number;
  indexer?: WikiFileIndexer;
}

export interface PostApplyMaintenanceResult {
  indexRebuilt: boolean;
  logAppended: boolean;
  warning: string;
}

export async function postApplyMaintenance(
  workspace: string,
  options: PostApplyMaintenanceOptions,
): Promise<PostApplyMaintenanceResult> {
  const result: PostApplyMaintenanceResult = {
    indexRebuilt: false,
    logAppended: false,
    warning: "",
  };
  if (!workspace) return result;
  if (options.writtenPaths.length === 0 && options.deletedPaths.length === 0) return result;

  const builder = new IndexBuilder(workspace);
  try {
    await builder.rebuildIndex();
  } catch (error) {
    result.warning = `rebuild index: ${errorMessage(error)}`;
    console.warn(`PostApplyMaintenance: ${result.warning}`);
    return result;
  }
  result.indexRebuilt = true;

  if (options.indexer) {
    try {
      await options.indexer.indexFile(INDEX_REL_PATH);
    } catch (error) {
      console.warn(`PostApplyMaintenance: index ${INDEX_REL_PATH}: ${errorMessage(error)}`);
    }
  }

  if (shouldAppendOrganizeLog(options)) {
    const entry = buildOrganizeLogEntry(options);
    try {
      await appendWikiLogEntry(workspace, entry);
      result.logAppended = true;
      if (options.indexer) {
        try {
          await options.indexer.indexFile(LOG_REL_PATH);
        } catch (error) {
          console.warn(`PostApplyMaintenance: index ${LOG_REL_PATH}: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      const warning = `append log: ${errorMessage(error)}`;
      result.warning = result.warning ? `${result.warning}; ${warning}` : warning;
      console.warn(`PostApplyMaintenance: ${warning}`);
    }
  }

  return result;
}

function shouldAppendOrganizeLog(options: PostApplyMaintenanceOptions): boolean {
  if (options.sessionMode !== "organize") return false;
  return options.moveCount > 0 || options.mergeCount > 0;
}

function buildOrganizeLogEntry(options: PostApplyMaintenanceOptions): string {
  const date = formatDate(new Date());
  const parts: string[] = [];
  if (options.moveCount > 0) parts.push(`移动 ${options.moveCount} 页`);
  if (options.mergeCount > 0) parts.push(`合并 ${options.mergeCount} 组`);
  let summary = parts.join("，");
  const trimmed = options.planSummary.trim();
  if (trimmed) {
    const runes = [...trimmed];
    summary += `：${runes.length > 120 ? runes.slice(0, 120).join("") + "…" : trimmed}`;
  }
  return `## [${date}] organize | ${summary}\n`;
}

async function appendWikiLogEntry(workspace: string, entry: string): Promise<void> {
  const target = path.join(workspace, LOG_REL_PATH);
  let existing = "";
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  let output = "";
  if (existing.length > 0) {
    output += existing;
    if (!existing.endsWith("\n")) output += "\n";
    output += "\n";
  }
  output += entry;
  if (!entry.endsWith("\n")) output += "\n";
  await writeFile(target, output, "utf8");
}

function formatDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
