import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateWikiWritePath } from "../engine/wiki_org.js";
import { logger } from "../logger.js";
import { mergeWikiPage } from "./merge.js";
import type { ApplyWikiBlocksOptions, ApplyWikiResult } from "./types.js";

const FILE_BLOCK_RE = /---FILE:\s*(.+?)\n(.*?)---END FILE---/gs;

export class NoWikiFilesWrittenError extends Error {
  constructor() {
    super("no wiki files written from FILE blocks");
    this.name = "NoWikiFilesWrittenError";
  }
}

export function parseFileBlocks(output: string): string[] {
  const paths: string[] = [];
  for (const match of output.matchAll(FILE_BLOCK_RE)) {
    const value = (match[1] ?? "").trim();
    if (value) paths.push(value);
  }
  return paths;
}

export function parseFileBlocksWithContent(output: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of output.matchAll(FILE_BLOCK_RE)) {
    const filePath = (match[1] ?? "").trim();
    if (filePath) result.set(filePath, match[2] ?? "");
  }
  return result;
}

export function normalizeWikiFilePath(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("empty FILE path");
  if (value.startsWith("wiki/")) return value;
  const mappings: Array<[string, string]> = [
    ["entities/", "wiki/entities/"],
    ["entity/", "wiki/entities/"],
    ["concepts/", "wiki/concepts/"],
    ["concept/", "wiki/concepts/"],
    ["sources/", "wiki/sources/"],
    ["source/", "wiki/sources/"],
    ["synthesis/", "wiki/synthesis/"],
    ["comparisons/", "wiki/comparisons/"],
    ["comparison/", "wiki/comparisons/"],
    ["queries/", "wiki/queries/"],
    ["query/", "wiki/queries/"],
  ];
  for (const [prefix, target] of mappings) {
    if (value.startsWith(prefix)) return target + value.slice(prefix.length);
  }
  throw new Error(`unrecognized wiki FILE path prefix: ${value}`);
}

export function normalizeWikiFileBlocks(blocks: Map<string, string>): {
  blocks: Map<string, string>;
  adjustments: string[];
} {
  const out = new Map<string, string>();
  const adjustments: string[] = [];
  for (const [filePath, content] of blocks) {
    const normalized = normalizeWikiFilePath(filePath);
    if (normalized !== filePath) adjustments.push(`${filePath} -> ${normalized}`);
    out.set(normalized, content);
  }
  return { blocks: out, adjustments };
}

export async function applyWikiBlocks(
  workspace: string,
  blocks: Map<string, string>,
  options: ApplyWikiBlocksOptions | null,
): Promise<ApplyWikiResult> {
  const rawCount = blocks.size;
  const normalized = normalizeWikiFileBlocks(blocks);
  if (normalized.adjustments.length > 0) {
    logger.info({ adjustments: normalized.adjustments }, "ApplyWikiBlocks normalized paths");
  }

  const result: ApplyWikiResult = { written: [], deleted: [] };
  let handled = 0;
  for (const [filePath, content] of normalized.blocks) {
    const fullPath = path.join(workspace, filePath);

    if (content === "---DELETE---\n") {
      try {
        await rm(fullPath, { force: true });
        result.deleted.push(filePath);
      } catch (error) {
        logger.warn({ path: filePath, error }, "ApplyWikiBlocks delete failed");
      }
      continue;
    }

    validateWikiWritePath(filePath);

    let writeContent = content;
    if (options?.merge && !options.forceOverwrite) {
      const merged = await mergeWikiPage(fullPath, content, options.merge);
      if (merged === null) {
        handled += 1;
        continue;
      }
      writeContent = merged;
    }

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, writeContent, "utf8");
    result.written.push(filePath);
    handled += 1;
  }

  if (
    rawCount > 0 &&
    result.written.length === 0 &&
    result.deleted.length === 0 &&
    handled === 0
  ) {
    throw new NoWikiFilesWrittenError();
  }
  return result;
}

export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
