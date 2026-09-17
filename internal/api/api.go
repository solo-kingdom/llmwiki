package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/acp"
	"github.com/solo-kingdom/llmwiki/internal/agentruntime"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type API struct {
	db                *sqlite.DB
	workspace         string // workspace root directory for file-first writes
	lockMgr           *ingest.PageLockManager
	indexer           *engine.WorkspaceFileIndexer
	publicWikiEnabled bool
	acpMgr            *acp.Manager
}

func New(db *sqlite.DB) *API {
	return &API{
		db: db,
	}
}

// SetWorkspace sets the workspace root directory for file-first write operations.
func (a *API) SetWorkspace(ws string) {
	a.workspace = ws
}

// SetLockManager sets the page-level lock manager for same-page serialization.
func (a *API) SetLockManager(lm *ingest.PageLockManager) {
	a.lockMgr = lm
}

// SetPublicWikiEnabled enables or disables public read-only wiki API routes.
func (a *API) SetPublicWikiEnabled(enabled bool) {
	a.publicWikiEnabled = enabled
}

// SetFileIndexer sets the workspace file indexer for search index updates.
func (a *API) SetFileIndexer(indexer *engine.WorkspaceFileIndexer) {
	a.indexer = indexer
}

func (a *API) SetACPManager(mgr *acp.Manager) {
	a.acpMgr = mgr
}

func (a *API) sessionAgentRuntime(session *sqlite.IngestSession) (agentruntime.Runtime, error) {
	return agentruntime.Resolve(a.db, a.workspace, a.acpMgr, session)
}

func runtimeErrorMessage(err error) string {
	switch {
	case errors.Is(err, agentruntime.ErrNoProviderInstance):
		return "请先选择 Provider 实例和 Model"
	case errors.Is(err, agentruntime.ErrNoACPAgent):
		return "请先在 Settings 配置并选择 ACP Agent"
	case errors.Is(err, agentruntime.ErrACPAgentDisabled):
		return "该 ACP Agent 已禁用"
	case errors.Is(err, agentruntime.ErrACPCLINotFound):
		return "ACP Agent 命令未找到，请确认已安装并在 PATH 中"
	case errors.Is(err, agentruntime.ErrACPConfigInvalid):
		return err.Error()
	default:
		return err.Error()
	}
}

func (a *API) indexDocumentRelPath(relPath string) {
	if a.indexer == nil || relPath == "" {
		return
	}
	if err := a.indexer.IndexFile(relPath); err != nil {
		log.Printf("api: index %s: %v", relPath, err)
	}
}

func (a *API) indexDocumentContent(docID, content string) {
	if a.indexer == nil || docID == "" {
		return
	}
	if err := a.indexer.IndexDocumentContent(docID, content); err != nil {
		log.Printf("api: index document %s: %v", docID, err)
	}
}

// instanceLLMClient creates an LLM client for a given provider instance and model.
func (a *API) instanceLLMClient(instanceID, model string) (*llm.Client, string, string) {
	client, err := llm.ClientFromInstance(a.db, instanceID, model)
	if err != nil || client == nil {
		return nil, instanceID, model
	}
	return client, instanceID, model
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	if status >= 500 {
		log.Printf("[API ERROR] %d: %s", status, msg)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getID(r *http.Request) string {
	return chi.URLParam(r, "id")
}

func getIntQuery(r *http.Request, key string, defaultVal int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}
