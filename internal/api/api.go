package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type API struct {
	db                 *sqlite.DB
	workspace          string // workspace root directory for file-first writes
	lockMgr            *ingest.PageLockManager
	publicWikiEnabled  bool
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

// sessionLLMClient creates an LLM client for the given session.
// It reads instance/model from the session, falls back to global defaults,
// then reads API key from provider_instances table.
func (a *API) sessionLLMClient(session *sqlite.IngestSession) (*llm.Client, string, string) {
	instanceID := session.LLMInstanceID
	model := session.LLMModel

	if instanceID == "" {
		instanceID, _ = a.db.GetConfig("last_instance_id")
	}
	if model == "" {
		model, _ = a.db.GetConfig("last_model")
	}
	if instanceID == "" || model == "" {
		return nil, "", ""
	}

	return a.instanceLLMClient(instanceID, model)
}

// instanceLLMClient creates an LLM client for a given provider instance and model.
func (a *API) instanceLLMClient(instanceID, model string) (*llm.Client, string, string) {
	inst, err := a.db.GetProviderInstance(instanceID)
	if err != nil || inst == nil {
		return nil, instanceID, model
	}

	apiKey := inst.APIKey
	if apiKey == "" {
		return nil, instanceID, model
	}

	// Determine API format and base URL from catalog
	apiFormat := "openai"
	baseURL := inst.BaseURL
	pInfo, _ := a.db.GetProviderInfo(inst.CatalogID)
	if pInfo != nil {
		apiFormat = pInfo.APIFormat
		if baseURL == "" {
			baseURL = pInfo.APIBase
		}
	}

	cfg := llm.Config{
		Provider:          apiFormat,
		BaseURL:           baseURL,
		APIKey:            apiKey,
		Model:             model,
		Timeout:           30 * time.Minute,
		StreamIdleTimeout: 2 * time.Minute,
	}
	return llm.NewClient(cfg), instanceID, model
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


