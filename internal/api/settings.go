package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
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
	ActivityLogsMaxCount     string `json:"activity_logs_max_count"`
	IngestJobEventsMaxCount string `json:"ingest_job_events_max_count"`
	MCPServersJSON          string `json:"mcp_servers_json"`
	UILanguage       string `json:"ui_language"`
	DocLanguage      string `json:"doc_language"`
	RulesSupplement  string `json:"rules_supplement"`
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
		ActivityLogsMaxCount:      activityLogsMaxCountForResponse(all["activity_logs_max_count"]),
		IngestJobEventsMaxCount:   jobEventsMaxCountForResponse(all["ingest_job_events_max_count"]),
		MCPServersJSON:            mcpServersJSONForResponse(all["mcp_servers_json"]),
		UILanguage:      languageForResponse(all["ui_language"]),
		DocLanguage:     languageForResponse(all["doc_language"]),
		RulesSupplement: all["rules_supplement"],
	})
}

func mcpServersJSONForResponse(stored string) string {
	if strings.TrimSpace(stored) == "" {
		canonical, _ := mcp.CanonicalJSON(mcp.DefaultConfig())
		return canonical
	}
	cfg, err := mcp.ParseConfig(stored)
	if err != nil {
		return stored
	}
	canonical, err := mcp.CanonicalJSON(cfg)
	if err != nil {
		return stored
	}
	return canonical
}

func jobEventsMaxCountForResponse(stored string) string {
	if strings.TrimSpace(stored) == "" {
		return strconv.Itoa(sqlite.DefaultJobEventsMaxCount)
	}
	return stored
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
		"activity_logs_max_count":      true,
		"ingest_job_events_max_count": true,
		"mcp_servers_json":            true,
		"ui_language":      true,
		"doc_language":     true,
		"rules_supplement": true,
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
		if key == "ingest_job_events_max_count" {
			if _, err := sqlite.ParseJobEventsMaxCount(value); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if key == "mcp_servers_json" {
			canonical, err := validateAndCanonicalizeMCPJSON(value)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			value = canonical
		}
		if key == "ui_language" || key == "doc_language" {
			if !isValidLanguage(value) {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("%s must be 'zh' or 'en", key))
				return
			}
		}
		if key == "rules_supplement" {
			if err := validateRulesSupplement(value); err != nil {
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

	if raw, ok := req["ingest_job_events_max_count"]; ok {
		value, err := parseSettingsValue(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		maxN, err := sqlite.ParseJobEventsMaxCount(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := a.db.TrimAllIngestJobEvents(maxN); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	// Return updated settings
	a.GetSettings(w, r)
}

func validateAndCanonicalizeMCPJSON(value string) (string, error) {
	cfg, err := mcp.ParseConfig(value)
	if err != nil {
		if ve, ok := err.(*mcp.ValidationError); ok {
			return "", fmt.Errorf("%s", ve.Error())
		}
		return "", err
	}
	return mcp.CanonicalJSON(cfg)
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

// isValidLanguage checks if a language code is supported (zh or en).
func isValidLanguage(lang string) bool {
	return lang == "zh" || lang == "en"
}

// languageForResponse returns the language code or the default "zh" if empty/invalid.
func languageForResponse(stored string) string {
	if isValidLanguage(stored) {
		return stored
	}
	return "zh"
}

// ResolveDocLanguage reads the doc_language setting from the database, falling back to "zh".
func ResolveDocLanguage(db interface{ GetConfig(string) (string, error) }) string {
	val, err := db.GetConfig("doc_language")
	if err != nil || !isValidLanguage(val) {
		return "zh"
	}
	return val
}

func validateRulesSupplement(s string) error {
	return ingest.ValidateRulesSupplement(s)
}

// LanguageInstruction builds a prompt fragment that constrains LLM output language.
func LanguageInstruction(docLang string) string {
	switch docLang {
	case "zh":
		return "重要：你必须使用中文撰写所有文档正文。英文术语可以用括号注释，但不允许英文大段正文主导。文档标题、段落、说明文字必须使用中文。"
	case "en":
		return "Important: You must write all document content in English. Technical terms may include brief annotations, but no large blocks of non-English text in the main body. Titles, paragraphs, and descriptions must be in English."
	default:
		return ""
	}
}
