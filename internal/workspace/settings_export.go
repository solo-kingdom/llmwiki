package workspace

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const settingsExportRelPath = ".llmwiki/workspace-settings.json"

// settingsFile is the on-disk export format (no API keys).
type settingsFile struct {
	Version int               `json:"version"`
	Values  map[string]string `json:"values"`
}

var exportKeys = []string{
	"last_instance_id", "last_model", "job_instance_id", "job_model",
	"temperature", "max_tokens", "chunk_size", "chunk_overlap",
	"auto_reindex", "watch_sources",
	"activity_logs_max_count", "ingest_job_events_max_count", "session_message_events_max_count",
	"mcp_servers_json", "ui_language", "doc_language", "rules_supplement",
	mcp.ConfigSessionToolLoopMaxRoundsIngest,
	mcp.ConfigSessionToolLoopMaxRoundsQA,
	mcp.ConfigSessionToolLoopMaxRoundsOrganize,
	mcp.ConfigSessionToolLoopMaxCallsPerRound,
	sqlite.ConfigBackupIncludeRaw,
	sqlite.ConfigVCAutoPush,
}

// ExportSettings writes non-secret app_config values to workspace-settings.json.
func ExportSettings(db *sqlite.DB, workspace string) error {
	if db == nil || workspace == "" {
		return nil
	}
	values := make(map[string]string)
	for _, key := range exportKeys {
		v, err := db.GetConfig(key)
		if err != nil {
			return err
		}
		if v != "" {
			values[key] = v
		}
	}
	payload := settingsFile{Version: 1, Values: values}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(workspace, settingsExportRelPath)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// ImportSettingsIfEmpty imports from export file when app_config has no core settings.
func ImportSettingsIfEmpty(db *sqlite.DB, workspace string) error {
	if db == nil || workspace == "" {
		return nil
	}
	last, _ := db.GetConfig("last_instance_id")
	temp, _ := db.GetConfig("temperature")
	if strings.TrimSpace(last) != "" || strings.TrimSpace(temp) != "" {
		return nil
	}
	return ImportSettings(db, workspace)
}

// ImportSettings loads values from workspace-settings.json into app_config.
func ImportSettings(db *sqlite.DB, workspace string) error {
	path := filepath.Join(workspace, settingsExportRelPath)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var file settingsFile
	if err := json.Unmarshal(data, &file); err != nil {
		log.Printf("[workspace] skip settings import: invalid JSON: %v", err)
		return nil
	}
	if file.Version != 1 {
		log.Printf("[workspace] skip settings import: unsupported version %d", file.Version)
		return nil
	}
	for key, value := range file.Values {
		if !isImportableKey(key) {
			continue
		}
		if err := db.SetConfig(key, value); err != nil {
			return fmt.Errorf("import %s: %w", key, err)
		}
	}
	return nil
}

func isImportableKey(key string) bool {
	for _, k := range exportKeys {
		if k == key {
			return true
		}
	}
	return false
}
