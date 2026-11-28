import type { ChangeSetListFilter, ChangeSetListResult } from "./history_list.js";
import type { IngestJobListFilter, IngestJobListResult } from "./job_list.js";
import type { CacheEntry } from "../ingest/types.js";
import type {
  ActivityLog,
  ActivityLogListFilter,
  ApiKeyRecord,
  ArchiveFile,
  ArchiveFileKind,
  ArchiveFolder,
  ArchiveFolderWithCounts,
  ArchiveLinkedDocument,
  ArchiveSearchHit,
  ArchiveSearchOptions,
  ArchiveSourceSummary,
  ArchiveStorageBackend,
  ChangeSet,
  Chunk,
  ChunkEmbedding,
  DeleteArchiveFolderResult,
  DeleteFolderResult,
  Document,
  FolderDeleteMode,
  GraphData,
  GraphEdge,
  IngestJob,
  IngestJobEvent,
  IngestReview,
  IngestReviewMessage,
  IngestReviewPlan,
  IngestSession,
  IngestSessionMessage,
  IngestSessionReference,
  ListDocumentsFilter,
  ModelInfo,
  MoveArchiveFolderResult,
  MoveDocumentResult,
  MoveFolderResult,
  PageRevision,
  PageWrite,
  ProviderInfo,
  ProviderInstance,
  ProviderInstanceUpdatePatch,
  RefEdge,
  ReferenceSummary,
  ReferenceEntryInput,
  ReferenceEntryView,
  SearchChunk,
  SearchOptions,
  SessionMessageEvent,
  SourceBlob,
  StalePage,
  UncitedSource,
  WikiFolder,
  WikiFolderWithCounts,
  Workspace,
} from "./types.js";

export interface DocumentStore {
  createDocument(doc: Document): Promise<void>;
  getDocument(id: string): Promise<Document | null>;
  findDocumentByName(name: string): Promise<Document | null>;
  getDocumentByPath(filename: string, dirPath: string): Promise<Document | null>;
  getDocumentByRelativePath(relativePath: string): Promise<Document | null>;
  getWikiDocumentByID(id: string): Promise<Document | null>;
  updateDocument(
    id: string,
    content: string,
    title: string,
    tags: string[],
    date: string,
    metadata: string,
  ): Promise<void>;
  archiveDocuments(ids: string[]): Promise<number>;
  listDocuments(): Promise<Document[]>;
  listDocumentsFiltered(filter: ListDocumentsFilter): Promise<Document[]>;
  listDocumentsWithContent(): Promise<Document[]>;
}

export interface IndexStore {
  storeChunks(docID: string, chunks: Chunk[]): Promise<void>;
  deleteChunks(docID: string): Promise<void>;
  searchChunks(
    query: string,
    limit: number,
    pathFilter: string,
    options?: string[] | SearchOptions,
  ): Promise<SearchChunk[]>;

  deleteReferences(sourceDocID: string): Promise<void>;
  upsertReference(sourceID: string, targetID: string, refType: string, page: number | null): Promise<void>;
  replaceReferencesInTx(sourceDocID: string, edges: RefEdge[]): Promise<void>;
  replaceReferenceEntriesInTx(docID: string, entries: ReferenceEntryInput[]): Promise<void>;
  mergeReferenceEntriesInTx(docID: string, entries: ReferenceEntryInput[]): Promise<void>;
  listReferenceEntries(docID: string): Promise<ReferenceEntryView[]>;
  getBacklinks(docID: string): Promise<ReferenceSummary[]>;
  getForwardReferences(docID: string): Promise<ReferenceSummary[]>;
  findUncitedSources(): Promise<UncitedSource[]>;
  findStalePages(): Promise<StalePage[]>;
  propagateStaleness(docID: string): Promise<void>;
  listWikiGraphEdges(): Promise<GraphEdge[]>;
  buildKnowledgeGraph(limit: number, folderPrefix?: string): Promise<GraphData>;

  storeChunkEmbeddings(embeddings: ChunkEmbedding[]): Promise<void>;
  searchVector(
    vector: number[],
    model: string,
    limit: number,
    pathFilter: string,
    options?: string[] | SearchOptions,
  ): Promise<SearchChunk[]>;
  chunksMissingEmbedding(model: string, limit: number): Promise<Chunk[]>;
}

export interface RevisionStore {
  applyChangeSet(cs: ChangeSet, writes: PageWrite[]): Promise<void>;
  getChangeSet(id: string): Promise<ChangeSet | null>;
  listChangeSets(filter: ChangeSetListFilter): Promise<ChangeSetListResult>;
  listChangeSetRevisions(changeSetID: string): Promise<PageRevision[]>;
  listPageRevisions(relativePath: string, limit: number): Promise<PageRevision[]>;
  latestRevision(documentID: string): Promise<PageRevision | null>;
  getRevision(id: string): Promise<PageRevision | null>;
  undoChangeSet(changeSetID: string, actor: string): Promise<ChangeSet>;
  restoreRevision(revisionID: string, actor: string): Promise<ChangeSet>;
  seedInitialRevisions(actor: string): Promise<number>;
}

export interface SourceStore {
  createSourceBlob(blob: SourceBlob, data: Uint8Array): Promise<void>;
  getSourceBlob(id: string): Promise<{ blob: SourceBlob; data: Uint8Array } | null>;
  getSourceBlobBySHA(sha: string): Promise<{ blob: SourceBlob; data: Uint8Array } | null>;
  listSourceBlobs(): Promise<SourceBlob[]>;
  deleteSourceBlob(id: string): Promise<void>;
}

export interface JobStore {
  createIngestJob(job: IngestJob): Promise<void>;
  getIngestJob(id: string): Promise<IngestJob | null>;
  getIngestJobBySourceRef(sourceRef: string, inputType: string): Promise<IngestJob | null>;
  listIngestJobs(filter: IngestJobListFilter): Promise<IngestJobListResult>;
  updateIngestJobStatus(id: string, status: string): Promise<void>;
  updateIngestJobFailure(
    id: string,
    errorCode: string,
    message: string,
    missingDep: string,
    remediation: string,
  ): Promise<void>;
  markIngestJobSucceeded(id: string, summary: string): Promise<void>;
  resetIngestJobToQueued(id: string): Promise<void>;
  deleteIngestJob(id: string): Promise<void>;
  getJobLineage(id: string): Promise<IngestJob[]>;
  cancelIngestJob(id: string): Promise<boolean>;
  retryIngestJob(id: string): Promise<IngestJob | null>;
  claimNextIngestJob(runnerID: string): Promise<IngestJob | null>;
  touchIngestJobHeartbeat(jobID: string, runnerID: string): Promise<void>;
  clearIngestJobLease(jobID: string): Promise<void>;
  recoverStaleRunningJobs(): Promise<string[]>;

  insertIngestJobEvent(
    jobID: string,
    step: string,
    phase: string,
    message: string,
    payload: Record<string, unknown>,
    maxPerJob: number,
  ): Promise<void>;
  listIngestJobEvents(jobID: string, limit: number): Promise<IngestJobEvent[]>;
  trimIngestJobEvents(jobID: string, maxCount: number): Promise<void>;
  trimAllIngestJobEvents(maxCount: number): Promise<void>;
  getJobEventsMaxCount(): Promise<number>;
}

export interface SessionStore {
  countIngestSessions(): Promise<number>;
  createIngestSession(session: IngestSession): Promise<void>;
  getIngestSession(id: string): Promise<IngestSession | null>;
  listIngestSessions(): Promise<IngestSession[]>;
  updateIngestSessionStoragePath(id: string, path: string): Promise<void>;
  updateIngestSessionTitle(id: string, title: string): Promise<void>;
  updateIngestSessionStatus(id: string, status: string): Promise<void>;
  updateIngestSessionMode(id: string, mode: string): Promise<void>;
  updateIngestSessionAgent(id: string, agentKind: string, acpAgentID: string): Promise<void>;
  updateIngestSessionLLM(id: string, instanceID: string, model: string): Promise<void>;
  updateIngestSessionStatusAndTitle(id: string, status: string, title: string): Promise<void>;
  deleteIngestSession(id: string): Promise<void>;

  createIngestSessionMessage(msg: IngestSessionMessage): Promise<void>;
  getIngestSessionMessage(id: string): Promise<IngestSessionMessage | null>;
  listIngestSessionMessages(sessionID: string): Promise<IngestSessionMessage[]>;
  updateIngestSessionMessageContent(id: string, content: string, streamStatus: string): Promise<void>;
  updateIngestSessionMessageExclude(id: string, exclude: boolean): Promise<void>;
  countUserSessionMessages(sessionID: string): Promise<number>;

  upsertSessionReference(
    sessionID: string,
    documentID: string,
    relativePath: string,
    title: string,
    source: string,
  ): Promise<void>;
  listSessionReferences(sessionID: string): Promise<IngestSessionReference[]>;
  countSessionReference(sessionID: string, documentID: string): Promise<number>;

  insertSessionMessageEvent(
    messageID: string,
    step: string,
    phase: string,
    message: string,
    payload: Record<string, unknown>,
    maxPerMessage: number,
  ): Promise<void>;
  listSessionMessageEvents(messageID: string, limit: number): Promise<SessionMessageEvent[]>;
  trimSessionMessageEvents(messageID: string, maxCount: number): Promise<void>;
  getSessionMsgEventsMaxCount(): Promise<number>;
}

export interface ReviewStore {
  createIngestReview(review: IngestReview): Promise<void>;
  getIngestReview(id: string): Promise<IngestReview | null>;
  getLatestIngestReviewBySessionID(sessionID: string): Promise<IngestReview | null>;
  countIngestReviewsBySessionID(sessionID: string): Promise<number>;
  deleteIngestReview(id: string): Promise<void>;
  listIngestReviews(limit: number): Promise<IngestReview[]>;
  updateIngestReviewStatus(id: string, newStatus: string): Promise<void>;
  setIngestReviewPlanVersion(id: string, version: number): Promise<void>;
  setIngestReviewApprovedPlan(id: string, version: number): Promise<void>;
  setIngestReviewFinalJob(id: string, jobID: string): Promise<void>;
  setIngestReviewChangeSet(id: string, changeSetID: string): Promise<void>;

  createIngestReviewMessage(msg: IngestReviewMessage): Promise<void>;
  listIngestReviewMessages(reviewID: string): Promise<IngestReviewMessage[]>;
  createIngestReviewPlan(plan: IngestReviewPlan): Promise<void>;
  listIngestReviewPlans(reviewID: string): Promise<IngestReviewPlan[]>;
  getIngestReviewPlan(reviewID: string, version: number): Promise<IngestReviewPlan | null>;
  nextIngestReviewPlanVersion(reviewID: string): Promise<number>;
}

export interface ConfigStore {
  getConfig(key: string): Promise<string>;
  setConfig(key: string, value: string): Promise<void>;
  getAllConfig(): Promise<Record<string, string>>;
  maxConcurrentJobs(): Promise<number>;
  parallelEnabled(): Promise<boolean>;
}

export interface ProviderStore {
  createProviderInstance(inst: ProviderInstance): Promise<void>;
  getProviderInstance(id: string): Promise<ProviderInstance | null>;
  listProviderInstances(): Promise<ProviderInstance[]>;
  updateProviderInstance(id: string, patch: ProviderInstanceUpdatePatch): Promise<void>;
  deleteProviderInstance(id: string): Promise<void>;

  upsertProviderInfo(providers: ProviderInfo[]): Promise<void>;
  upsertModels(models: ModelInfo[]): Promise<void>;
  listProviders(): Promise<ProviderInfo[]>;
  listModelsByProvider(providerID: string): Promise<ModelInfo[]>;
  getProviderInfo(providerID: string): Promise<ProviderInfo | null>;
  cacheIsEmpty(): Promise<boolean>;
  countCatalog(): Promise<{ provider_count: number; model_count: number }>;
}

export interface ActivityStore {
  createActivityLog(log: ActivityLog): Promise<void>;
  listActivityLogs(filter: ActivityLogListFilter): Promise<ActivityLog[]>;
  countActivityLogs(category: string, level: string): Promise<number>;
  deleteAllActivityLogs(): Promise<number>;
  trimActivityLogs(maxCount: number): Promise<number>;
  getActivityLog(id: number): Promise<ActivityLog | null>;
}

export interface WorkspaceStore {
  getWorkspace(): Promise<Workspace | null>;
  upsertWorkspace(ws: Workspace): Promise<void>;
}

export interface FolderStore {
  listFolders(excludeHidden?: boolean, includeArchived?: boolean): Promise<WikiFolderWithCounts[]>;
  getFolder(folderPath: string): Promise<WikiFolder | null>;
  ensureFolders(folderPaths: string[]): Promise<void>;
  createFolder(input: {
    path: string;
    display_name?: string;
    description?: string;
    sort_order?: number;
  }): Promise<WikiFolder>;
  updateFolder(
    folderPath: string,
    patch: { display_name?: string; description?: string; sort_order?: number },
  ): Promise<WikiFolder | null>;
  moveFolder(
    fromPath: string,
    toPath: string,
    actor?: string,
    options?: { onConflict?: "fail" | "merge" },
  ): Promise<MoveFolderResult>;
  deleteFolder(
    folderPath: string,
    mode: FolderDeleteMode,
    targetFolder?: string,
    actor?: string,
  ): Promise<DeleteFolderResult>;
  moveDocument(
    docId: string,
    targetFolder: string,
    newFilename?: string,
    actor?: string,
  ): Promise<MoveDocumentResult>;
}

export interface ApiKeyStore {
  createApiKey(input: { id: string; name: string; key_hash: string; prefix: string }): Promise<ApiKeyRecord>;
  listApiKeys(): Promise<ApiKeyRecord[]>;
  countApiKeys(): Promise<number>;
  findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  touchApiKey(id: string): Promise<void>;
  deleteApiKey(id: string): Promise<boolean>;
}

export interface ArchiveStore {
  listArchiveFolders(): Promise<ArchiveFolderWithCounts[]>;
  getArchiveFolder(folderPath: string): Promise<ArchiveFolder | null>;
  ensureArchiveFolders(folderPaths: string[]): Promise<void>;
  createArchiveFolder(input: {
    path: string;
    display_name?: string;
    description?: string;
    sort_order?: number;
  }): Promise<ArchiveFolder>;
  updateArchiveFolder(
    folderPath: string,
    patch: { display_name?: string; description?: string; sort_order?: number },
  ): Promise<ArchiveFolder | null>;
  moveArchiveFolder(
    fromPath: string,
    toPath: string,
    options?: { onConflict?: "fail" | "merge" },
  ): Promise<MoveArchiveFolderResult>;
  deleteArchiveFolder(
    folderPath: string,
    mode: FolderDeleteMode,
    targetFolder?: string,
  ): Promise<DeleteArchiveFolderResult>;

  listArchiveFiles(filter?: { folder_path?: string; kind?: string; q?: string }): Promise<ArchiveFile[]>;
  getArchiveFile(id: string): Promise<ArchiveFile | null>;
  getArchiveFileByRelativePath(relativePath: string): Promise<ArchiveFile | null>;
  findArchiveFileBySha256?(sha256: string, folderPath?: string): Promise<ArchiveFile | null>;
  getArchiveFileInlineBytes(id: string): Promise<Uint8Array | null>;
  createArchiveFile(
    file: ArchiveFile,
    inlineBytes: Uint8Array | null,
    searchableText?: string,
  ): Promise<ArchiveFile>;
  updateArchiveFileLocation(id: string, folderPath: string, filename: string): Promise<ArchiveFile>;
  setArchiveFileIngestJobId?(id: string, jobId: string): Promise<void>;
  updateArchiveFileTitle?(id: string, title: string): Promise<ArchiveFile | null>;
  updateArchiveFileMeta?(
    id: string,
    patch: { title?: string; source_ref?: string },
  ): Promise<ArchiveFile | null>;
  mergeDuplicateArchiveFiles?(
    keepId: string,
    dropIds: string[],
    patch?: { folderPath?: string; filename?: string; title?: string },
  ): Promise<ArchiveFile>;
  updateArchiveFileContentMeta(
    id: string,
    patch: {
      size: number;
      sha256: string;
      storage_backend: ArchiveStorageBackend;
      storage_key: string;
      inline_bytes: Uint8Array | null;
      media_type?: string;
      kind?: ArchiveFileKind;
      searchable_text?: string;
    },
  ): Promise<ArchiveFile>;
  listArchiveFilesMissingSearchText(limit?: number): Promise<ArchiveFile[]>;
  updateArchiveFileSearchableText(id: string, searchableText: string): Promise<void>;
  searchArchiveFiles(
    query: string,
    options?: ArchiveSearchOptions,
  ): Promise<ArchiveSearchHit[]>;
  deleteArchiveFile(id: string): Promise<ArchiveFile | null>;

  linkDocumentArchiveSource(
    documentId: string,
    archiveFileId: string,
    changeSetId?: string,
    relation?: string,
  ): Promise<void>;
  unlinkDocumentArchiveSource(documentId: string, archiveFileId: string): Promise<boolean>;
  listDocumentArchiveSources(documentId: string): Promise<ArchiveSourceSummary[]>;
  listArchiveFileDocuments(archiveFileId: string): Promise<ArchiveLinkedDocument[]>;
}

export interface IngestCacheStore {
  getIngestCacheEntry?(cacheKey: string): Promise<CacheEntry | null>;
  upsertIngestCacheEntry?(cacheKey: string, entry: CacheEntry): Promise<void>;
  deleteIngestCacheEntry?(cacheKey: string): Promise<void>;
}

export interface Store
  extends DocumentStore,
    FolderStore,
    ArchiveStore,
    IndexStore,
    RevisionStore,
    SourceStore,
    JobStore,
    SessionStore,
    ReviewStore,
    ConfigStore,
    ProviderStore,
    ActivityStore,
    WorkspaceStore,
    ApiKeyStore,
    IngestCacheStore {
  close(): Promise<void>;
}
