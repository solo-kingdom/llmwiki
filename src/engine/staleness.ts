import { ReferenceParser } from "./references.js";
import type { BacklinkInfo, DocEntry, EngineStore, RefEdge } from "./store_iface.js";

export class StalenessPropagator {
  constructor(private readonly store: EngineStore) {}

  async propagateAfterWrite(docID: string): Promise<void> {
    await this.store.propagateStaleness(docID);
  }

  async syncReferencesAfterWrite(docID: string, content: string, docPath: string): Promise<void> {
    const documents = await this.store.listAllDocuments();
    const parser = new ReferenceParser(
      documents.map((doc) => ({
        id: doc.id,
        filename: doc.filename,
        title: doc.title,
        path: doc.path,
      })),
    );
    const references = parser.parseReferences(content, docPath);
    const edges: RefEdge[] = references.map((reference) => ({
      sourceId: docID,
      targetId: reference.targetPath,
      refType: reference.refType,
      page: reference.page,
    }));
    await this.store.replaceReferencesInTx(docID, edges);
  }

  async getBacklinkSummary(docID: string): Promise<BacklinkInfo[]> {
    return this.store.getBacklinks(docID);
  }

  async writeImpactReport(docID: string): Promise<BacklinkInfo[]> {
    return this.store.getBacklinks(docID);
  }
}

export function newStalenessPropagator(store: EngineStore): StalenessPropagator {
  return new StalenessPropagator(store);
}

export function backlinkAppendix(backlinks: BacklinkInfo[]): string {
  if (backlinks.length === 0) return "";
  let result = `\n\n---\n**Referenced by (${backlinks.length})**\n`;
  for (const backlink of backlinks) {
    const title = backlink.title || backlink.filename;
    result += `- [[${title}]] (${backlink.referenceType})\n`;
  }
  return result;
}

export function buildReferenceIndex(docs: DocEntry[]): ReferenceParser {
  return new ReferenceParser(
    docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      title: doc.title,
      path: doc.path,
    })),
  );
}
