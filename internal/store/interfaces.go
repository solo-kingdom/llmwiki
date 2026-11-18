package store

// Store is the full persistence surface used by the application.
// Implementations must be safe for concurrent use.
type Store interface {
	DocumentStore
	IndexStore
	RevisionStore
	SourceStore
	JobStore
	SessionStore
	ReviewStore
	ConfigStore
	ProviderStore
	ActivityStore
	WorkspaceStore

	Close() error
}

// DocumentStore manages pages and source documents.
type DocumentStore interface {
	CreateDocument(doc *Document) error
	GetDocument(id string) (*Document, error)
	FindDocumentByName(name string) (*Document, error)
	GetDocumentByPath(filename, dirPath string) (*Document, error)
	GetDocumentByRelativePath(relativePath string) (*Document, error)
	GetWikiDocumentByID(id string) (*Document, error)
	UpdateDocument(id, content, title string, tags []string, date, metadata string) error
	ArchiveDocuments(ids []string) (int64, error)
	ClearDerivedIndex() error
	ListDocuments() ([]Document, error)
	ListDocumentsFiltered(f ListDocumentsFilter) ([]Document, error)
	ListDocumentsWithContent() ([]Document, error)
}

// IndexStore manages chunks, references, graph and retrieval.
type IndexStore interface {
	StoreChunks(docID string, chunks []Chunk) error
	DeleteChunks(docID string) error
	SearchChunks(query string, limit int, pathFilter string, pageTypes ...string) ([]SearchChunk, error)

	DeleteReferences(sourceDocID string) error
	UpsertReference(sourceID, targetID, refType string, page *int) error
	ReplaceReferencesInTx(sourceDocID string, edges []RefEdge) error
	GetBacklinks(docID string) ([]ReferenceSummary, error)
	GetForwardReferences(docID string) ([]ReferenceSummary, error)
	FindUncitedSources() ([]UncitedSource, error)
	FindStalePages() ([]StalePage, error)
	PropagateStaleness(docID string) error
	ListWikiGraphEdges() ([]GraphEdge, error)
	BuildKnowledgeGraph(limit int) (*GraphData, error)

	StoreChunkEmbeddings(embeddings []ChunkEmbedding) error
	SearchVector(vector []float32, model string, limit int, pathFilter string, pageTypes ...string) ([]SearchChunk, error)
	ChunksMissingEmbedding(model string, limit int) ([]Chunk, error)
}

// PageWrite is one page mutation inside a change set.
type PageWrite struct {
	// RelativePath identifies the page for deletes when Document is nil.
	RelativePath string
	Document     *Document // nil means delete
	Operation    RevisionOperation
	Chunks       []Chunk
	Refs         []RefEdge
}

// RevisionStore owns the append-only history and deterministic rollback.
type RevisionStore interface {
	ApplyChangeSet(cs *ChangeSet, writes []PageWrite) error
	GetChangeSet(id string) (*ChangeSet, error)
	ListChangeSets(limit int, before string) ([]ChangeSet, error)
	ListChangeSetRevisions(changeSetID string) ([]PageRevision, error)
	ListPageRevisions(relativePath string, limit int) ([]PageRevision, error)
	LatestRevision(documentID string) (*PageRevision, error)
	GetRevision(id string) (*PageRevision, error)
	UndoChangeSet(changeSetID, actor string) (*ChangeSet, error)
	RestoreRevision(revisionID, actor string) (*ChangeSet, error)
	SeedInitialRevisions(actor string) (int, error)
}

// SourceStore stores immutable raw source bytes.
type SourceStore interface {
	CreateSourceBlob(blob *SourceBlob, data []byte) error
	GetSourceBlob(id string) (*SourceBlob, []byte, error)
	GetSourceBlobBySHA(sha string) (*SourceBlob, []byte, error)
	ListSourceBlobs() ([]SourceBlob, error)
	DeleteSourceBlob(id string) error
}

// JobStore is the ingest job queue.
type JobStore interface {
	CreateIngestJob(job *IngestJob) error
	GetIngestJob(id string) (*IngestJob, error)
	GetIngestJobBySourceRef(sourceRef, inputType string) (*IngestJob, error)
	ListIngestJobs(limit int) ([]IngestJob, error)
	UpdateIngestJobStatus(id, status string) error
	UpdateIngestJobFailure(id, errorCode, message, missingDep, remediation string) error
	MarkIngestJobSucceeded(id, summary string) error
	ResetIngestJobToQueued(id string) error
	DeleteIngestJob(id string) error
	GetJobLineage(id string) ([]IngestJob, error)
	CancelIngestJob(id string) (bool, error)
	RetryIngestJob(id string) (*IngestJob, error)
	ClaimNextIngestJob(runnerID string) (*IngestJob, error)
	TouchIngestJobHeartbeat(jobID, runnerID string) error
	ClearIngestJobLease(jobID string)
	RecoverStaleRunningJobs() ([]string, error)

	InsertIngestJobEvent(jobID, step, phase, message string, payload map[string]any, maxPerJob int) error
	ListIngestJobEvents(jobID string, limit int) ([]IngestJobEvent, error)
	TrimIngestJobEvents(jobID string, maxCount int) error
	TrimAllIngestJobEvents(maxCount int) error
	GetJobEventsMaxCount() int
}

// SessionStore is chat/ingest sessions, messages, references and trace events.
type SessionStore interface {
	CountIngestSessions() (int, error)
	CreateIngestSession(session *IngestSession) error
	GetIngestSession(id string) (*IngestSession, error)
	ListIngestSessions() ([]IngestSession, error)
	UpdateIngestSessionStoragePath(id, path string) error
	UpdateIngestSessionTitle(id, title string) error
	UpdateIngestSessionStatus(id, status string) error
	UpdateIngestSessionMode(id, mode string) error
	UpdateIngestSessionAgent(id, agentKind, acpAgentID string) error
	UpdateIngestSessionLLM(id, instanceID, model string) error
	UpdateIngestSessionStatusAndTitle(id, status, title string) error
	DeleteIngestSession(id string) error

	CreateIngestSessionMessage(msg *IngestSessionMessage) error
	GetIngestSessionMessage(id string) (*IngestSessionMessage, error)
	ListIngestSessionMessages(sessionID string) ([]IngestSessionMessage, error)
	UpdateIngestSessionMessageContent(id, content, streamStatus string) error
	UpdateIngestSessionMessageExclude(id string, exclude bool) error
	CountUserSessionMessages(sessionID string) (int, error)

	UpsertSessionReference(sessionID, documentID, relativePath, title, source string) error
	ListSessionReferences(sessionID string) ([]IngestSessionReference, error)
	CountSessionReference(sessionID, documentID string) (int, error)

	InsertSessionMessageEvent(messageID, step, phase, message string, payload map[string]any, maxPerMessage int) error
	ListSessionMessageEvents(messageID string, limit int) ([]SessionMessageEvent, error)
	TrimSessionMessageEvents(messageID string, maxCount int) error
	GetSessionMsgEventsMaxCount() int
}

// ReviewStore is the review/plan state machine.
type ReviewStore interface {
	CreateIngestReview(r *IngestReview) error
	GetIngestReview(id string) (*IngestReview, error)
	GetLatestIngestReviewBySessionID(sessionID string) (*IngestReview, error)
	CountIngestReviewsBySessionID(sessionID string) (int, error)
	DeleteIngestReview(id string) error
	ListIngestReviews(limit int) ([]IngestReview, error)
	UpdateIngestReviewStatus(id, newStatus string) error
	SetIngestReviewPlanVersion(id string, version int) error
	SetIngestReviewApprovedPlan(id string, version int) error
	SetIngestReviewFinalJob(id, jobID string) error
	SetIngestReviewChangeSet(id, changeSetID string) error

	CreateIngestReviewMessage(m *IngestReviewMessage) error
	ListIngestReviewMessages(reviewID string) ([]IngestReviewMessage, error)
	CreateIngestReviewPlan(p *IngestReviewPlan) error
	ListIngestReviewPlans(reviewID string) ([]IngestReviewPlan, error)
	GetIngestReviewPlan(reviewID string, version int) (*IngestReviewPlan, error)
	NextIngestReviewPlanVersion(reviewID string) (int, error)
}

// ConfigStore is key/value application configuration.
type ConfigStore interface {
	GetConfig(key string) (string, error)
	SetConfig(key, value string) error
	GetAllConfig() (map[string]string, error)
	MaxConcurrentJobs() int
	ParallelEnabled() bool
}

// ProviderStore stores provider instances and cache.
type ProviderStore interface {
	CreateProviderInstance(inst *ProviderInstance) error
	GetProviderInstance(id string) (*ProviderInstance, error)
	ListProviderInstances() ([]ProviderInstance, error)
	UpdateProviderInstance(id, name, catalogID, apiKey, baseURL string) error
	DeleteProviderInstance(id string) error

	UpsertProviderInfo(providers []ProviderInfo) error
	UpsertModels(models []ModelInfo) error
	ListProviders() ([]ProviderInfo, error)
	ListModelsByProvider(providerID string) ([]ModelInfo, error)
	GetProviderInfo(providerID string) (*ProviderInfo, error)
	CacheIsEmpty() (bool, error)
}

// ActivityStore is the activity log.
type ActivityStore interface {
	CreateActivityLog(log *ActivityLog) error
	ListActivityLogs(f ActivityLogListFilter) ([]ActivityLog, error)
	CountActivityLogs(category, level string) (int, error)
	DeleteAllActivityLogs() (int64, error)
	TrimActivityLogs(maxCount int) (int64, error)
	GetActivityLog(id int64) (*ActivityLog, error)
}

// WorkspaceStore stores the single workspace row.
type WorkspaceStore interface {
	GetWorkspace() (*Workspace, error)
	UpsertWorkspace(ws *Workspace) error
}
