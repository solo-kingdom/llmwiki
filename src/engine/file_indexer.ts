import { Reindexer, indexDocumentContent } from "./reindex.js";
import { StalenessPropagator } from "./staleness.js";
import type { EngineStore } from "./store_iface.js";

export class WorkspaceFileIndexer {
  private readonly reindexer: Reindexer;
  private readonly staleness: StalenessPropagator;

  constructor(
    private readonly store: EngineStore,
    workspace: string,
  ) {
    this.reindexer = new Reindexer(store, workspace);
    this.staleness = new StalenessPropagator(store);
  }

  async indexFile(relPath: string): Promise<void> {
    const normalized = filepathToSlash(relPath);
    if (!isIndexableRelPath(normalized)) return;
    const docID = await this.reindexer.indexRelPath(normalized);
    if (normalized.startsWith("wiki/")) {
      await this.syncReferences(docID, normalized);
    }
  }

  private async syncReferences(docID: string, relPath: string): Promise<void> {
    if (!docID) return;
    let dir = "/";
    let filename = relPath;
    const lastSlash = relPath.lastIndexOf("/");
    if (lastSlash >= 0) {
      dir = `/${relPath.slice(0, lastSlash)}/`;
      filename = relPath.slice(lastSlash + 1);
    }
    try {
      const doc = await this.store.getDocumentByPath(filename, dir);
      if (!doc) return;
      await this.staleness.syncReferencesAfterWrite(docID, doc.content, relPath);
    } catch (error) {
      console.warn(`Warning: failed to sync references for ${relPath}: ${errorMessage(error)}`);
    }
  }

  async updateFile(relPath: string): Promise<void> {
    await this.indexFile(relPath);
  }

  async indexDocumentContent(docID: string, content: string): Promise<void> {
    await indexDocumentContent(this.store, docID, content);
  }

  async removeFile(relPath: string): Promise<void> {
    const normalized = filepathToSlash(relPath);
    let dir = "/";
    let filename = normalized;
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash >= 0) {
      dir = `/${normalized.slice(0, lastSlash)}/`;
      filename = normalized.slice(lastSlash + 1);
    }
    const doc = await this.store.getDocumentByPath(filename, dir);
    if (!doc) return;
    await this.store.archiveDocument(doc.id);
  }
}

export function filepathToSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isIndexableRelPath(relPath: string): boolean {
  if (!relPath || relPath.startsWith(".")) return false;
  return relPath.startsWith("raw/") || relPath.startsWith("wiki/");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
