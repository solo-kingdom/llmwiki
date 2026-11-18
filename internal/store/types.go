// Package store defines the database-agnostic persistence contract for llmwiki.
// PostgreSQL is the single source of truth; DTOs here intentionally mirror the
// API/JSON shapes that existed on the SQLite store so call sites stay stable.
package store

const (
	SessionRefSourceUserMention = "user_mention"
	SessionRefSourceToolRead    = "tool_read"

	DefaultJobEventsMaxCount = 200
	MinJobEventsMaxCount     = 50
	MaxJobEventsMaxCount     = 2000

	DefaultSessionMsgEventsMaxCount = 100
	MinSessionMsgEventsMaxCount     = 10
	MaxSessionMsgEventsMaxCount     = 500

	DefaultMaxConcurrentJobs = 3
	StaleHeartbeatSeconds    = 120
)

// Document represents a page or source row.
type Document struct {
	ID             string   `json:"id"`
	UserID         string   `json:"user_id"`
	Filename       string   `json:"filename"`
	Title          string   `json:"title"`
	Path           string   `json:"path"`
	RelativePath   string   `json:"relative_path"`
	SourceKind     string   `json:"source_kind"`
	FileType       string   `json:"file_type"`
	FileSize       int64    `json:"file_size"`
	DocumentNumber int64    `json:"document_number"`
	Status         string   `json:"status"`
	PageCount      int64    `json:"page_count"`
	Content        string   `json:"content"`
	Tags           []string `json:"tags"`
	Date           string   `json:"date"`
	Metadata       string   `json:"metadata"`
	ErrorMessage   string   `json:"error_message"`
	Version        int64    `json:"version"`
	Parser         string   `json:"parser"`
	ContentHash    string   `json:"content_hash"`
	StaleSince     string   `json:"stale_since"`
	Highlights     string   `json:"highlights"`
	CreatedAt      string   `json:"created_at"`
	UpdatedAt      string   `json:"updated_at"`
	DeletedAt      string   `json:"deleted_at,omitempty"`
	PageType       string   `json:"page_type,omitempty"`
}

// ListDocumentsFilter filters document listings.
type ListDocumentsFilter struct {
	SourceKind    string
	PageTypes     []string
	ExcludeHidden bool
}

// Chunk is a text chunk for full-text/vector indexing.
type Chunk struct {
	DocumentID       string
	ChunkIndex       int
	Content          string
	Page             int
	StartChar        int
	TokenCount       int
	HeaderBreadcrumb string
}

// SearchChunk is a search hit.
type SearchChunk struct {
	DocumentID       string  `json:"document_id"`
	Content          string  `json:"content"`
	Page             int     `json:"page"`
	HeaderBreadcrumb string  `json:"header_breadcrumb"`
	ChunkIndex       int     `json:"chunk_index"`
	Filename         string  `json:"filename"`
	Title            string  `json:"title"`
	Path             string  `json:"path"`
	FileType         string  `json:"file_type"`
	Score            float64 `json:"score"`
	MatchType        string  `json:"match_type,omitempty"`
}

// Reference is an edge in the citation/link graph.
type Reference struct {
	SourceDocumentID string `json:"source_document_id"`
	TargetDocumentID string `json:"target_document_id"`
	ReferenceType    string `json:"reference_type"`
	Page             int    `json:"page"`
}

// ReferenceSummary is used for backlink/forward reference display.
type ReferenceSummary struct {
	Path          string `json:"path"`
	Filename      string `json:"filename"`
	Title         string `json:"title"`
	ReferenceType string `json:"reference_type"`
	Page          int    `json:"page"`
}

// StalePage is a page marked as stale.
type StalePage struct {
	Filename   string `json:"filename"`
	Title      string `json:"title"`
	Path       string `json:"path"`
	StaleSince string `json:"stale_since"`
}

// UncitedSource is a source document with no wiki citations.
type UncitedSource struct {
	Filename string `json:"filename"`
	Title    string `json:"title"`
	Path     string `json:"path"`
	FileType string `json:"file_type"`
}

// RefEdge is a reference edge for bulk replacement.
type RefEdge struct {
	SourceID string
	TargetID string
	RefType  string
	Page     *int
}

// GraphNode is a wiki page node for the knowledge graph API.
type GraphNode struct {
	ID         string `json:"id"`
	DocumentID string `json:"document_id"`
	Title      string `json:"title"`
	Type       string `json:"type"`
	LinkCount  int    `json:"link_count"`
}

// GraphEdge is a reference edge for the knowledge graph API.
type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

// GraphData holds nodes and edges for the knowledge graph visualization.
type GraphData struct {
	Nodes      []GraphNode `json:"nodes"`
	Edges      []GraphEdge `json:"edges"`
	TotalNodes int         `json:"total_nodes"`
	Truncated  bool        `json:"truncated"`
}

// IngestJob is a persisted ingest queue entry.
type IngestJob struct {
	ID                string `json:"id"`
	ParentJobID       string `json:"parent_job_id"`
	InputType         string `json:"input_type"`
	SourcePath        string `json:"source_path"`
	SourceRef         string `json:"source_ref"`
	Status            string `json:"status"`
	Retries           int    `json:"retries"`
	MaxRetries        int    `json:"max_retries"`
	Error             string `json:"error"`
	ErrorCode         string `json:"error_code"`
	ErrorMessage      string `json:"error_message"`
	MissingDependency string `json:"missing_dependency"`
	Remediation       string `json:"remediation"`
	ResultSummary     string `json:"result_summary"`
	RunnerID          string `json:"runner_id,omitempty"`
	HeartbeatAt       string `json:"heartbeat_at,omitempty"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

// IngestJobEvent is a single execution trace row for an ingest job.
type IngestJobEvent struct {
	ID        int64  `json:"id"`
	JobID     string `json:"job_id"`
	Step      string `json:"step"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	Payload   string `json:"payload"`
	CreatedAt string `json:"created_at"`
}

// IngestSession is a chat/ingest session.
type IngestSession struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Status        string `json:"status"`
	StoragePath   string `json:"storage_path"`
	LLMInstanceID string `json:"llm_instance_id"`
	LLMModel      string `json:"llm_model"`
	Mode          string `json:"mode"`
	AgentKind     string `json:"agent_kind"`
	ACPAgentID    string `json:"acp_agent_id"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

// IngestSessionMessage is one message in a session.
type IngestSessionMessage struct {
	ID                 string `json:"id"`
	SessionID          string `json:"session_id"`
	Role               string `json:"role"`
	Content            string `json:"content"`
	MessageType        string `json:"message_type"`
	AttachmentID       string `json:"attachment_id"`
	StreamStatus       string `json:"stream_status"`
	WikiRefsJSON       string `json:"wiki_refs_json,omitempty"`
	ExcludeFromArchive bool   `json:"exclude_from_archive"`
	CreatedAt          string `json:"created_at"`
}

// IngestSessionReference tracks a wiki page referenced during session chat.
type IngestSessionReference struct {
	ID           string `json:"id"`
	SessionID    string `json:"session_id"`
	DocumentID   string `json:"document_id"`
	RelativePath string `json:"relative_path"`
	Title        string `json:"title"`
	Source       string `json:"source"`
	FirstSeenAt  string `json:"first_seen_at"`
}

// SessionMessageEvent is a debug trace row for a chat session message.
type SessionMessageEvent struct {
	ID        int64  `json:"id"`
	MessageID string `json:"message_id"`
	Step      string `json:"step"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	Payload   string `json:"payload"`
	CreatedAt string `json:"created_at"`
}

// IngestReview is a reviewed ingest plan.
type IngestReview struct {
	ID                  string `json:"id"`
	SessionID           string `json:"session_id"`
	ArchiveSourcePath   string `json:"archive_source_path"`
	Status              string `json:"status"`
	CurrentPlanVersion  int    `json:"current_plan_version"`
	ApprovedPlanVersion int    `json:"approved_plan_version"`
	FinalJobID          string `json:"final_job_id,omitempty"`
	ChangeSetID         string `json:"change_set_id,omitempty"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
	DeepOrganize        bool   `json:"deep_organize"`
}

// ActiveReviewSummary is a lightweight review snapshot for session detail API.
type ActiveReviewSummary struct {
	ReviewID           string `json:"review_id"`
	Status             string `json:"status"`
	CurrentPlanVersion int    `json:"current_plan_version"`
	ChangeSetID        string `json:"change_set_id,omitempty"`
}

// IngestReviewMessage is a message attached to a review.
type IngestReviewMessage struct {
	ID          string `json:"id"`
	ReviewID    string `json:"review_id"`
	Role        string `json:"role"`
	MessageType string `json:"message_type"`
	Content     string `json:"content"`
	CreatedAt   string `json:"created_at"`
}

// IngestReviewPlan is one version of a review plan.
type IngestReviewPlan struct {
	ID           string `json:"id"`
	ReviewID     string `json:"review_id"`
	Version      int    `json:"version"`
	PlanMarkdown string `json:"plan_markdown"`
	PlanJSON     string `json:"plan_json"`
	CreatedAt    string `json:"created_at"`
}

// ActivityLog is a persisted system activity record.
type ActivityLog struct {
	ID           int64  `json:"id"`
	CreatedAt    string `json:"created_at"`
	Level        string `json:"level"`
	Category     string `json:"category"`
	Action       string `json:"action"`
	Message      string `json:"message"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	Status       string `json:"status"`
	Details      string `json:"details"`
	Source       string `json:"source"`
}

// ActivityLogListFilter filters activity log queries.
type ActivityLogListFilter struct {
	Limit    int
	Offset   int
	Category string
	Level    string
}

// ProviderInstance stores a user-added provider configuration.
type ProviderInstance struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CatalogID  string `json:"catalog_id"`
	APIKey     string `json:"api_key"`
	APIKeyMask string `json:"api_key_masked,omitempty"`
	BaseURL    string `json:"base_url"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// ProviderInfo holds cached metadata for a single provider.
type ProviderInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	APIBase   string `json:"api_base"`
	APIFormat string `json:"api_format"`
	EnvKey    string `json:"env_key"`
	DocURL    string `json:"doc_url"`
}

// ModelInfo holds cached metadata for a single model.
type ModelInfo struct {
	ProviderID   string  `json:"provider_id"`
	ModelID      string  `json:"model_id"`
	Name         string  `json:"name"`
	Family       string  `json:"family"`
	ContextLimit int     `json:"context_limit"`
	OutputLimit  int     `json:"output_limit"`
	CostInput    float64 `json:"cost_input"`
	CostOutput   float64 `json:"cost_output"`
	Reasoning    bool    `json:"reasoning"`
	ToolCall     bool    `json:"tool_call"`
	Attachment   bool    `json:"attachment"`
	Modalities   string  `json:"modalities"`
}

// Workspace is the single workspace row for this database.
type Workspace struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	UserID      string `json:"user_id"`
	CreatedAt   string `json:"created_at"`
}

// SourceBlob is an immutable raw source file stored in PostgreSQL.
type SourceBlob struct {
	ID         string `json:"id"`
	DocumentID string `json:"document_id"`
	Filename   string `json:"filename"`
	MediaType  string `json:"media_type"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
	CreatedAt  string `json:"created_at"`
}

// ChangeSet is one atomic write operation (ingest, review apply, rollback, manual, delete, import).
type ChangeSet struct {
	ID                string `json:"id"`
	Kind              string `json:"kind"`
	JobID             string `json:"job_id,omitempty"`
	ReviewID          string `json:"review_id,omitempty"`
	SourceBlobID      string `json:"source_blob_id,omitempty"`
	SourceFilename    string `json:"source_filename,omitempty"`
	NormalizedContent string `json:"normalized_content,omitempty"`
	Summary           string `json:"summary,omitempty"`
	RollbackOf        string `json:"rollback_of,omitempty"`
	PageCount         int    `json:"page_count"`
	CreatedAt         string `json:"created_at"`
}

// RevisionOperation enumerates page revision operations.
type RevisionOperation string

const (
	RevisionCreate  RevisionOperation = "create"
	RevisionUpdate  RevisionOperation = "update"
	RevisionDelete  RevisionOperation = "delete"
	RevisionRestore RevisionOperation = "restore"
)

// PageRevision is one page snapshot within a change set.
type PageRevision struct {
	ID               string            `json:"id"`
	DocumentID       string            `json:"document_id,omitempty"`
	RelativePath     string            `json:"relative_path"`
	RevisionNo       int               `json:"revision_no"`
	ParentRevisionID string            `json:"parent_revision_id,omitempty"`
	ChangeSetID      string            `json:"change_set_id"`
	Operation        RevisionOperation `json:"operation"`
	Title            string            `json:"title"`
	Content          string            `json:"content"`
	Metadata         string            `json:"metadata"`
	ContentHash      string            `json:"content_hash"`
	SourceKind       string            `json:"source_kind"`
	FileType         string            `json:"file_type"`
	Actor            string            `json:"actor"`
	CreatedAt        string            `json:"created_at"`
}

// ChunkEmbedding is one embedding vector for a chunk under a model.
type ChunkEmbedding struct {
	ChunkID   string
	Model     string
	Dim       int
	Embedding []float32
}
