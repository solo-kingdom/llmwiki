package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type API struct {
	db       *sqlite.DB
	settings *SettingsConfig
}

func New(db *sqlite.DB) *API {
	return &API{
		db: db,
		settings: &SettingsConfig{
			LLMProvider:    "openai",
			LLMModel:       "gpt-4",
			MaxTokens:      4096,
			APIKey:         "",
			APIKeyMasked:   "",
			Temperature:    0.7,
			ChunkSize:      512,
			ChunkOverlap:   64,
			AutoReindex:    true,
			WatchSources:   true,
		},
	}
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
