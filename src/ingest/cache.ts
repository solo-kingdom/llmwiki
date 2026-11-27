import { createHash } from "node:crypto";
import path from "node:path";
import type { Store } from "../store/interfaces.js";
import type { CacheEntry, NormalizedSource } from "./types.js";

export function contentSHA256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function cacheKeyForNormalized(source: NormalizedSource | null, rulesHash = ""): string {
  if (!source) return "";
  const sha = contentSHA256(source.content);
  return rulesHash ? `${sha}|${rulesHash}` : `${source.canonicalPath}|${sha}`;
}

function entryContentHash(entry: CacheEntry | null): string {
  if (!entry) return "";
  return entry.content_sha256 || entry.sha256;
}

export class IngestCache {
  private readonly memoryEntries = new Map<string, CacheEntry>();

  constructor(
    private readonly _workspace: string,
    private readonly db: Store | null = null,
  ) {}

  async lookup(key: string, contentHash: string, legacyKeys: string[]): Promise<CacheEntry | null> {
    for (const candidate of [key, ...legacyKeys]) {
      if (!candidate) continue;
      const entry =
        this.db && typeof this.db.getIngestCacheEntry === "function"
          ? await this.db.getIngestCacheEntry(candidate).catch(() => null)
          : (this.memoryEntries.get(candidate) ?? null);
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
    rulesHash = "",
  ): Promise<CacheEntry | null> {
    if (!source) return null;
    const keys = rulesHash
      ? [cacheKeyForNormalized(source, rulesHash), ...legacyKeys]
      : [cacheKeyForNormalized(source), ...legacyKeys];
    for (const key of keys) {
      const hit = await this.lookup(key, contentSHA256(source.content), []);
      if (hit) return hit;
    }
    return null;
  }

  async save(key: string, entry: CacheEntry): Promise<void> {
    if (!key || !entry) return;
    if (this.db && typeof this.db.upsertIngestCacheEntry === "function") {
      await this.db.upsertIngestCacheEntry(key, entry);
      return;
    }
    this.memoryEntries.set(key, entry);
  }

  async saveForSource(source: NormalizedSource | null, files: string[], rulesHash = ""): Promise<void> {
    if (!source) return;
    const hash = contentSHA256(source.content);
    await this.save(cacheKeyForNormalized(source, rulesHash), {
      source_name: path.posix.basename(source.canonicalPath),
      sha256: hash,
      content_sha256: hash,
      written_files: files,
    });
  }

  private async writtenFilesExist(files: string[]): Promise<boolean> {
    if (!files || files.length === 0) return false;
    if (!this.db) return true;
    for (const rel of files) {
      try {
        const doc = await this.db.getDocumentByRelativePath(rel);
        if (!doc) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}
