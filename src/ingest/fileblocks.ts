import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateWikiWritePath } from "../engine/wiki_org.js";
import { logger } from "../logger.js";
import { mergeWikiPage } from "./merge.js";
import type { ApplyWikiBlocksOptions, ApplyWikiResult } from "./types.js";

interface ScannedFileBlock {
  path: string;
  content: string;
}

/**
 * Tolerant scanner: accepts the canonical `---FILE: ... ---END FILE---` form and
 * blocks whose terminator is omitted (common with reasoning providers such as
 * MiniMax, which start a new FILE block or simply end the message instead).
 */
function scanFileBlocks(output: string): ScannedFileBlock[] {
  const blocks: ScannedFileBlock[] = [];
  let current: ScannedFileBlock | null = null;
  for (const line of output.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("---FILE:")) {
      if (current) blocks.push(current);
      current = { path: trimmed.slice("---FILE:".length).trim(), content: "" };
      continue;
    }
    if (current && trimmed.startsWith("---END FILE---")) {
      blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.content += `${line}\n`;
  }
  if (current) blocks.push(current);
  return blocks;
}

export class NoWikiFilesWrittenError extends Error {
  constructor() {
    super("no wiki files written from FILE blocks");
    this.name = "NoWikiFilesWrittenError";
  }
}

export function parseFileBlocks(output: string): string[] {
  return scanFileBlocks(output)
    .map((block) => block.path.trim())
    .filter((value) => value.length > 0);
}

export function parseFileBlocksWithContent(output: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const block of scanFileBlocks(output)) {
    const filePath = block.path.trim();
    if (filePath) result.set(filePath, block.content);
  }
  return result;
}

export function normalizeWikiFilePath(input: string): string {
  const value = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
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
    ["experiences/", "wiki/experiences/"],
    ["experience/", "wiki/experiences/"],
    ["ledgers/", "wiki/ledgers/"],
    ["ledger/", "wiki/ledgers/"],
    ["comparisons/", "wiki/comparisons/"],
    ["comparison/", "wiki/comparisons/"],
    ["queries/", "wiki/queries/"],
    ["query/", "wiki/queries/"],
  ];
  for (const [prefix, target] of mappings) {
    if (value.startsWith(prefix)) return target + value.slice(prefix.length);
  }
  if (value.includes("/")) return `wiki/${value}`;
  throw new Error(`unrecognized wiki FILE path prefix: ${value}`);
}

export function normalizeWikiFileBlocks(blocks: Map<string, string>): {
  blocks: Map<string, string>;
  adjustments: string[];
} {
  const out = new Map<string, string>();
  const adjustments: string[] = [];
  for (const [filePath, content] of blocks) {
    try {
      const normalized = normalizeWikiFilePath(filePath);
      if (normalized !== filePath) adjustments.push(`${filePath} -> ${normalized}`);
      out.set(normalized, content);
    } catch (error) {
      // A single out-of-vocabulary path (models often emit purpose.md / index.md
      // or bare page names) must not fail the whole ingest; keep the valid pages.
      adjustments.push(`skipped ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
