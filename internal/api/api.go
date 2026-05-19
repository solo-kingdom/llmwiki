package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type API struct {
	db        *sqlite.DB
	workspace string // workspace root directory for file-first writes
	lockMgr   *ingest.PageLockManager
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

// sessionLLMClient creates an LLM client for the given session.
// It reads provider/model from the session, falls back to global defaults,
// then reads API key from provider_keys table.
func (a *API) sessionLLMClient(session *sqlite.IngestSession) (*llm.Client, string, string) {
	provider := session.LLMProvider
	model := session.LLMModel

	if provider == "" {
		provider, _ = a.db.GetConfig("last_provider")
	}
	if model == "" {
		model, _ = a.db.GetConfig("last_model")
	}
	if provider == "" || model == "" {
		return nil, "", ""
	}

	return a.providerLLMClient(provider, model)
}

// providerLLMClient creates an LLM client for a given provider and model.
func (a *API) providerLLMClient(provider, model string) (*llm.Client, string, string) {
	apiKey, baseURL, _ := a.db.GetProviderKey(provider)

	// Check environment variable fallback
	if apiKey == "" {
		pInfo, _ := a.db.GetProviderInfo(provider)
		if pInfo != nil && pInfo.EnvKey != "" {
			envKey := pInfo.EnvKey
			// Check the env var
			if v := getEnvOrDefault(envKey, ""); v != "" {
				apiKey = v
			}
		}
	}

	if apiKey == "" {
		return nil, provider, model
	}

	// Determine API format and base URL
	apiFormat := "openai"
	pInfo, _ := a.db.GetProviderInfo(provider)
	if pInfo != nil {
		apiFormat = pInfo.APIFormat
		if baseURL == "" {
			baseURL = pInfo.APIBase
		}
	}

	// Set default base URLs for providers without cached info
	if baseURL == "" {
		switch provider {
		case "openai":
			baseURL = "https://api.openai.com/v1"
		case "anthropic":
			baseURL = "https://api.anthropic.com"
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
	return llm.NewClient(cfg), provider, model
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
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

// getEnvOrDefault reads an environment variable or returns fallback.
func getEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
