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
	LastProvider string                       `json:"last_provider"`
	LastModel    string                       `json:"last_model"`
	Temperature  string                       `json:"temperature"`
	MaxTokens    string                       `json:"max_tokens"`
	ChunkSize    string                       `json:"chunk_size"`
	ChunkOverlap string                       `json:"chunk_overlap"`
	AutoReindex  string                       `json:"auto_reindex"`
	WatchSources string                       `json:"watch_sources"`
	ProviderKeys map[string]providerKeyStatus `json:"provider_keys"`
}

type providerKeyStatus struct {
	Has    bool   `json:"has_key"`
	Masked string `json:"masked"`
}

func (a *API) GetSettings(w http.ResponseWriter, r *http.Request) {
	all, err := a.db.GetAllConfig()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	pkeys, err := a.db.ListProviderKeys()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	pkMap := make(map[string]providerKeyStatus)
	for _, pk := range pkeys {
		pkMap[pk.ProviderID] = providerKeyStatus{
			Has:    pk.APIKey != "",
			Masked: maskKey(pk.APIKey),
		}
	}

	writeJSON(w, http.StatusOK, settingsResponse{
		LastProvider: all["last_provider"],
		LastModel:    all["last_model"],
		Temperature:  all["temperature"],
		MaxTokens:    all["max_tokens"],
		ChunkSize:    all["chunk_size"],
		ChunkOverlap: all["chunk_overlap"],
		AutoReindex:  all["auto_reindex"],
		WatchSources: all["watch_sources"],
		ProviderKeys: pkMap,
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
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Provider == "" || req.Model == "" {
		writeError(w, http.StatusBadRequest, "provider and model are required")
		return
	}
	if err := a.db.SetConfig("last_provider", req.Provider); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.db.SetConfig("last_model", req.Model); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"last_provider": req.Provider,
		"last_model":    req.Model,
	})
}

func (a *API) UpdateProviderKey(w http.ResponseWriter, r *http.Request) {
	providerID := getID(r)
	if providerID == "" {
		writeError(w, http.StatusBadRequest, "provider_id is required")
		return
	}

	var req struct {
		APIKey  string `json:"api_key"`
		BaseURL string `json:"base_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.APIKey == "" {
		// Delete the key
		if err := a.db.DeleteProviderKey(providerID); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}

	if err := a.db.SetProviderKey(providerID, req.APIKey, req.BaseURL); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	key, baseURL, _ := a.db.GetProviderKey(providerID)
	writeJSON(w, http.StatusOK, map[string]string{
		"provider_id": providerID,
		"masked_key":  maskKey(key),
		"base_url":    baseURL,
	})
}
