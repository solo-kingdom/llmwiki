import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CacheEntry, CacheFile, NormalizedSource } from "./types.js";

export function contentSHA256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function cacheKeyForNormalized(source: NormalizedSource | null): string {
  if (!source) return "";
  return `${source.canonicalPath}|${contentSHA256(source.content)}`;
}

function entryContentHash(entry: CacheEntry | null): string {
  if (!entry) return "";
  return entry.content_sha256 || entry.sha256;
}

export class IngestCache {
  constructor(private readonly workspace: string) {}

  cachePath(): string {
    return path.join(this.workspace, ".llmwiki", "cache.json");
  }

  async load(): Promise<CacheFile> {
    try {
      const data = await readFile(this.cachePath(), "utf8");
      const parsed = JSON.parse(data) as CacheFile;
      return { entries: parsed.entries ?? {} };
    } catch (error) {
      if (isNotFound(error)) return { entries: {} };
      throw error;
    }
  }

  async lookup(key: string, contentHash: string, legacyKeys: string[]): Promise<CacheEntry | null> {
    const file = await this.load();
    for (const candidate of [key, ...legacyKeys]) {
      if (!candidate) continue;
      const entry = file.entries[candidate];
      if (!entry) continue;
      if (entryContentHash(entry) !== contentHash) continue;
      if (!(await this.writtenFilesExist(entry.written_files))) continue;
      return entry;
    }
    return null;
  }

  async lookupForSource(
    source: NormalizedSource | null,
    legacyKeys: string[],
  ): Promise<CacheEntry | null> {
    if (!source) return null;
    return this.lookup(cacheKeyForNormalized(source), contentSHA256(source.content), legacyKeys);
  }

  async save(key: string, entry: CacheEntry): Promise<void> {
    if (!key || !entry) return;
    const dir = path.join(this.workspace, ".llmwiki");
    await mkdir(dir, { recursive: true });
    let file: CacheFile;
    try {
      file = await this.load();
    } catch {
      file = { entries: {} };
    }
    file.entries[key] = entry;
    await writeFile(this.cachePath(), JSON.stringify(file, null, 2), "utf8");
  }

  async saveForSource(source: NormalizedSource | null, files: string[]): Promise<void> {
    if (!source) return;
    const hash = contentSHA256(source.content);
    await this.save(cacheKeyForNormalized(source), {
      source_name: path.basename(source.canonicalPath),
      sha256: hash,
      content_sha256: hash,
      written_files: files,
    });
  }

  private async writtenFilesExist(files: string[]): Promise<boolean> {
    if (!files || files.length === 0) return false;
    for (const rel of files) {
      try {
        await stat(path.join(this.workspace, rel));
      } catch {
        return false;
      }
    }
    return true;
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
