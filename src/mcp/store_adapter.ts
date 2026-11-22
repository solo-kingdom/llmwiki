import type { Store } from "../store/interfaces.js";
import type {
  BacklinkInfo,
  ChunkData,
  DocData,
  DocEntry,
  EngineReferenceEntryInput,
  EngineReferenceEntryView,
  EngineStore,
  RefEdge,
} from "../engine/store_iface.js";
import type { Document } from "../store/types.js";

export function createEngineStoreAdapter(store: Store): EngineStore {
  return {
    async createDocument(doc: DocData): Promise<void> {
      const relativePath = `${doc.path.replace(/^\/+/, "")}${doc.filename}`;
      const record: Document = {
        id: doc.id,
        user_id: "default",
        filename: doc.filename,
        title: doc.title,
        path: doc.path,
        relative_path: relativePath,
        source_kind: doc.sourceKind,
        file_type: doc.fileType,
        file_size: doc.fileSize,
        document_number: 0,
        status: doc.status,
        page_count: 0,
        content: doc.content,
        tags: doc.tags,
        date: doc.date,
        metadata: doc.metadata,
        error_message: "",
        version: 0,
        parser: "",
        content_hash: doc.contentHash,
        stale_since: "",
        highlights: "[]",
        created_at: "",
        updated_at: "",
      };
      await store.createDocument(record);
      doc.id = record.id;
    },

    async updateDocument(
      id: string,
      content: string,
      title: string,
      tags: string[],
      date: string,
      metadata: string,
    ): Promise<void> {
      await store.updateDocument(id, content, title, tags, date, metadata);
    },

    async getDocumentByPath(filename: string, dirPath: string): Promise<DocData | null> {
      const doc = await store.getDocumentByPath(filename, dirPath);
      if (!doc) return null;
      return {
        id: doc.id,
        filename: doc.filename,
        title: doc.title,
        path: doc.path,
        content: doc.content,
        sourceKind: doc.source_kind,
        fileType: doc.file_type,
        fileSize: doc.file_size,
        status: doc.status,
        tags: doc.tags,
        date: doc.date,
        metadata: doc.metadata,
        contentHash: doc.content_hash,
      };
    },

    async getBacklinks(docID: string): Promise<BacklinkInfo[]> {
      const refs = await store.getBacklinks(docID);
      return refs.map((ref) => ({
        path: ref.path,
        filename: ref.filename,
        title: ref.title,
        referenceType: ref.reference_type,
      }));
    },

    async deleteChunks(docID: string): Promise<void> {
      await store.deleteChunks(docID);
    },

    async archiveDocument(docID: string): Promise<void> {
      await store.archiveDocuments([docID]);
    },

    async storeChunks(docID: string, chunks: ChunkData[]): Promise<void> {
      await store.storeChunks(
        docID,
        chunks.map((chunk) => ({
          id: "",
          document_id: chunk.documentId,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          page: chunk.page,
          start_char: chunk.startChar,
          token_count: chunk.tokenCount,
          header_breadcrumb: chunk.headerBreadcrumb,
        })),
      );
    },

    async replaceReferencesInTx(sourceDocID: string, edges: RefEdge[]): Promise<void> {
      await store.replaceReferencesInTx(
        sourceDocID,
        edges.map((edge) => ({
          source_id: edge.sourceId,
          target_id: edge.targetId,
          ref_type: edge.refType,
          page: edge.page,
        })),
      );
    },

    async replaceReferenceEntriesInTx(docID: string, entries: EngineReferenceEntryInput[]): Promise<void> {
      await store.replaceReferenceEntriesInTx(docID, entries);
    },

    async listReferenceEntries(docID: string): Promise<EngineReferenceEntryView[]> {
      return store.listReferenceEntries(docID);
    },

    async upsertReference(
      sourceID: string,
      targetID: string,
      refType: string,
      page: number | null,
    ): Promise<void> {
      await store.upsertReference(sourceID, targetID, refType, page);
    },

    async deleteReferences(sourceDocID: string): Promise<void> {
      await store.deleteReferences(sourceDocID);
    },

    async propagateStaleness(docID: string): Promise<void> {
      await store.propagateStaleness(docID);
    },

    async listAllDocuments(): Promise<DocEntry[]> {
      const docs = await store.listDocuments();
      return docs.map((doc) => ({
        id: doc.id,
        filename: doc.filename,
        title: doc.title,
        path: doc.path,
        content: "",
      }));
    },

    async listWikiDocuments(): Promise<DocEntry[]> {
      const docs = await store.listDocumentsWithContent();
      return docs
        .filter((doc) => doc.source_kind === "wiki")
        .map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          title: doc.title,
          path: doc.path,
          content: doc.content,
        }));
    },
  };
}
