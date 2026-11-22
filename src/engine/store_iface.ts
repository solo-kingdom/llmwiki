export interface BacklinkInfo {
  path: string;
  filename: string;
  title: string;
  referenceType: string;
}

export interface DocEntry {
  id: string;
  filename: string;
  title: string;
  path: string;
  content: string;
}

export interface DocData {
  id: string;
  filename: string;
  title: string;
  path: string;
  content: string;
  sourceKind: string;
  fileType: string;
  fileSize: number;
  status: string;
  tags: string[];
  date: string;
  metadata: string;
  contentHash: string;
}

export interface ChunkData {
  documentId: string;
  chunkIndex: number;
  content: string;
  page: number;
  startChar: number;
  tokenCount: number;
  headerBreadcrumb: string;
}

export interface RefEdge {
  sourceId: string;
  targetId: string;
  refType: string;
  page: number | null;
}

export interface EngineReferenceEntryInput {
  kind: "related" | "source";
  rawText: string;
  targetDocumentId: string;
  annotation: string;
  position: number;
}

export interface EngineReferenceEntryView {
  kind: "related" | "source";
  rawText: string;
  targetDocumentId: string;
  annotation: string;
  position: number;
  targetTitle: string;
  targetPath: string;
  targetFilename: string;
}

export interface EngineStore {
  propagateStaleness(docID: string): Promise<void>;
  getBacklinks(docID: string): Promise<BacklinkInfo[]>;
  createDocument(doc: DocData): Promise<void>;
  updateDocument(
    id: string,
    content: string,
    title: string,
    tags: string[],
    date: string,
    metadata: string,
  ): Promise<void>;
  getDocumentByPath(filename: string, dirPath: string): Promise<DocData | null>;
  deleteReferences(sourceDocID: string): Promise<void>;
  upsertReference(sourceID: string, targetID: string, refType: string, page: number | null): Promise<void>;
  replaceReferencesInTx(sourceDocID: string, edges: RefEdge[]): Promise<void>;
  replaceReferenceEntriesInTx(docID: string, entries: EngineReferenceEntryInput[]): Promise<void>;
  listReferenceEntries(docID: string): Promise<EngineReferenceEntryView[]>;
  listAllDocuments(): Promise<DocEntry[]>;
  listWikiDocuments(): Promise<DocEntry[]>;
  storeChunks(docID: string, chunks: ChunkData[]): Promise<void>;
  deleteChunks(docID: string): Promise<void>;
  archiveDocument(docID: string): Promise<void>;
}
