package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/activity"
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
	JobInstanceID  string `json:"job_instance_id"`
	JobModel       string `json:"job_model"`
	Temperature    string `json:"temperature"`
	MaxTokens      string `json:"max_tokens"`
	ChunkSize      string `json:"chunk_size"`
	ChunkOverlap   string `json:"chunk_overlap"`
	AutoReindex           string `json:"auto_reindex"`
	WatchSources          string `json:"watch_sources"`
	ActivityLogsMaxCount  string `json:"activity_logs_max_count"`
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
		JobInstanceID:  all["job_instance_id"],
		JobModel:       all["job_model"],
		Temperature:    all["temperature"],
		MaxTokens:      all["max_tokens"],
		ChunkSize:      all["chunk_size"],
		ChunkOverlap:   all["chunk_overlap"],
		AutoReindex:          all["auto_reindex"],
		WatchSources:         all["watch_sources"],
		ActivityLogsMaxCount: activityLogsMaxCountForResponse(all["activity_logs_max_count"]),
	})
}

func activityLogsMaxCountForResponse(stored string) string {
	if strings.TrimSpace(stored) == "" {
		return strconv.Itoa(activity.DefaultMaxCount)
	}
	return stored
}

func (a *API) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowedKeys := map[string]bool{
		"temperature": true, "max_tokens": true, "chunk_size": true,
		"chunk_overlap": true, "auto_reindex": true, "watch_sources": true,
		"job_instance_id": true, "job_model": true,
		"activity_logs_max_count": true,
	}

	for key, raw := range req {
		if !allowedKeys[key] {
			continue
		}
		value, err := parseSettingsValue(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if key == "activity_logs_max_count" {
			if _, err := activity.ParseMaxCount(value); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if err := a.db.SetConfig(key, value); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	if _, ok := req["activity_logs_max_count"]; ok {
		if _, err := a.trimActivityLogsNow(); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	// Return updated settings
	a.GetSettings(w, r)
}

// parseSettingsValue coerces JSON settings values to strings for app_config storage.
func parseSettingsValue(v interface{}) (string, error) {
	switch val := v.(type) {
	case string:
		return val, nil
	case float64:
		if val == float64(int64(val)) {
			return strconv.FormatInt(int64(val), 10), nil
		}
		return fmt.Sprintf("%v", val), nil
	case bool:
		return strconv.FormatBool(val), nil
	default:
		return fmt.Sprintf("%v", val), nil
	}
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
