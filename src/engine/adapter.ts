import type { Store } from "../store/interfaces.js";
import type { Document } from "../store/types.js";
import type { BacklinkInfo, ChunkData, DocData, DocEntry, EngineStore, RefEdge } from "./store_iface.js";

function toDocData(doc: Document): DocData {
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
}

function toDocEntry(doc: Document): DocEntry {
  return {
    id: doc.id,
    filename: doc.filename,
    title: doc.title,
    path: doc.path,
    content: doc.content,
  };
}

export function engineStoreFromStore(store: Store): EngineStore {
  return {
    propagateStaleness: (docID) => store.propagateStaleness(docID),

    getBacklinks: async (docID) => {
      const refs = await store.getBacklinks(docID);
      return refs.map(
        (ref): BacklinkInfo => ({
          path: ref.path,
          filename: ref.filename,
          title: ref.title,
          referenceType: ref.reference_type,
        }),
      );
    },

    createDocument: async (doc: DocData) => {
      const row: Document = {
        id: doc.id,
        user_id: "default",
        filename: doc.filename,
        title: doc.title,
        path: doc.path,
        relative_path: doc.path.replace(/^\/+/, "") + doc.filename,
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
      await store.createDocument(row);
      doc.id = row.id;
    },

    updateDocument: (id, content, title, tags, date, metadata) =>
      store.updateDocument(id, content, title, tags, date, metadata),

    getDocumentByPath: async (filename, dirPath) => {
      const doc = await store.getDocumentByPath(filename, dirPath);
      return doc ? toDocData(doc) : null;
    },

    deleteReferences: (sourceDocID) => store.deleteReferences(sourceDocID),

    upsertReference: (sourceID, targetID, refType, page) =>
      store.upsertReference(sourceID, targetID, refType, page),

    replaceReferencesInTx: async (sourceDocID, edges: RefEdge[]) => {
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

    replaceReferenceEntriesInTx: (docID, entries) =>
      store.replaceReferenceEntriesInTx(docID, entries),

    listReferenceEntries: (docID) => store.listReferenceEntries(docID),

    listAllDocuments: async () => (await store.listDocumentsWithContent()).map(toDocEntry),

    listWikiDocuments: async () =>
      (await store.listDocumentsWithContent())
        .filter((doc) => doc.source_kind === "wiki")
        .map(
          (doc): DocEntry => ({
            id: doc.id,
            filename: doc.filename,
            title: doc.title,
            path: doc.path,
            content: doc.content,
          }),
        ),

    storeChunks: async (docID, chunks: ChunkData[]) => {
      await store.storeChunks(
        docID,
        chunks.map((chunk) => ({
          id: "",
          document_id: docID,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          page: chunk.page,
          start_char: chunk.startChar,
          token_count: chunk.tokenCount,
          header_breadcrumb: chunk.headerBreadcrumb,
        })),
      );
    },

    deleteChunks: (docID) => store.deleteChunks(docID),

    archiveDocument: async (docID) => {
      await store.archiveDocuments([docID]);
    },
  };
}
