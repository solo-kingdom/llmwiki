package api

import (
	"encoding/json"
	"net/http"
	"strings"
)

func maskKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + strings.Repeat("*", len(key)-4)
}

// settingsResponse is the response payload for GET /settings.
type settingsResponse struct {
	LastInstanceID string `json:"last_instance_id"`
	LastModel      string `json:"last_model"`
	Temperature    string `json:"temperature"`
	MaxTokens      string `json:"max_tokens"`
	ChunkSize      string `json:"chunk_size"`
	ChunkOverlap   string `json:"chunk_overlap"`
	AutoReindex    string `json:"auto_reindex"`
	WatchSources   string `json:"watch_sources"`
}

func (a *API) GetSettings(w http.ResponseWriter, r *http.Request) {
	all, err := a.db.GetAllConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, settingsResponse{
		LastInstanceID: all["last_instance_id"],
		LastModel:      all["last_model"],
		Temperature:    all["temperature"],
		MaxTokens:      all["max_tokens"],
		ChunkSize:      all["chunk_size"],
		ChunkOverlap:   all["chunk_overlap"],
		AutoReindex:    all["auto_reindex"],
		WatchSources:   all["watch_sources"],
	})
}

func (a *API) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req map[string]string
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowedKeys := map[string]bool{
		"temperature": true, "max_tokens": true, "chunk_size": true,
		"chunk_overlap": true, "auto_reindex": true, "watch_sources": true,
	}

	for key, value := range req {
		if !allowedKeys[key] {
			continue
		}
		if err := a.db.SetConfig(key, value); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	// Return updated settings
	a.GetSettings(w, r)
}

func (a *API) UpdateLastModel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		InstanceID string `json:"instance_id"`
		Model      string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.InstanceID == "" || req.Model == "" {
		writeError(w, http.StatusBadRequest, "instance_id and model are required")
		return
	}
	if err := a.db.SetConfig("last_instance_id", req.InstanceID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.db.SetConfig("last_model", req.Model); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"last_instance_id": req.InstanceID,
		"last_model":       req.Model,
	})
}
