package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
)

type SettingsConfig struct {
	LLMProvider  string  `json:"llm_provider"`
	LLMModel     string  `json:"llm_model"`
	MaxTokens    int     `json:"max_tokens"`
	APIKey       string  `json:"-"`
	APIKeyMasked string  `json:"api_key"`
	Temperature  float64 `json:"temperature"`
	ChunkSize    int     `json:"chunk_size"`
	ChunkOverlap int     `json:"chunk_overlap"`
	AutoReindex  bool    `json:"auto_reindex"`
	WatchSources bool    `json:"watch_sources"`
}

var settingsMu sync.Mutex

func maskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + strings.Repeat("*", len(key)-4)
}

func (a *API) GetSettings(w http.ResponseWriter, r *http.Request) {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	cfg := *a.settings
	cfg.APIKeyMasked = maskKey(cfg.APIKey)

	writeJSON(w, http.StatusOK, cfg)
}

func (a *API) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req SettingsConfig
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	settingsMu.Lock()
	defer settingsMu.Unlock()

	if req.LLMProvider != "" {
		a.settings.LLMProvider = req.LLMProvider
	}
	if req.LLMModel != "" {
		a.settings.LLMModel = req.LLMModel
	}
	if req.MaxTokens > 0 {
		a.settings.MaxTokens = req.MaxTokens
	}
	if req.Temperature > 0 {
		a.settings.Temperature = req.Temperature
	}
	if req.ChunkSize > 0 {
		a.settings.ChunkSize = req.ChunkSize
	}
	if req.ChunkOverlap > 0 {
		a.settings.ChunkOverlap = req.ChunkOverlap
	}
	if req.APIKey != "" && req.APIKey != "****" {
		a.settings.APIKey = req.APIKey
	}
	a.settings.AutoReindex = req.AutoReindex
	a.settings.WatchSources = req.WatchSources

	cfg := *a.settings
	cfg.APIKeyMasked = maskKey(cfg.APIKey)

	writeJSON(w, http.StatusOK, cfg)
}
