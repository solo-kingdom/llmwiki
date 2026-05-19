package llm

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

//go:embed providers_snapshot.json
var snapshotJSON []byte

// SnapshotProvider represents a provider entry in the embedded snapshot.
type SnapshotProvider struct {
	ID        string                    `json:"id"`
	Name      string                    `json:"name"`
	Env       []string                  `json:"env"`
	APIBase   string                    `json:"api_base"`
	APIFormat string                    `json:"api_format"`
	Models    map[string]SnapshotModel  `json:"models"`
}

// SnapshotModel represents a model entry in the embedded snapshot.
type SnapshotModel struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ContextLimit int    `json:"context_limit"`
	OutputLimit  int    `json:"output_limit"`
	Reasoning    bool   `json:"reasoning"`
	ToolCall     bool   `json:"tool_call"`
	Attachment   bool   `json:"attachment"`
}

// LoadSnapshot parses the embedded provider snapshot and returns
// slices suitable for writing to the cache tables.
func LoadSnapshot() ([]sqlite.ProviderInfo, []sqlite.ModelInfo, error) {
	var providers map[string]SnapshotProvider
	if err := json.Unmarshal(snapshotJSON, &providers); err != nil {
		return nil, nil, fmt.Errorf("parse snapshot: %w", err)
	}

	var pInfo []sqlite.ProviderInfo
	var mInfo []sqlite.ModelInfo

	for _, sp := range providers {
		apiFormat := sp.APIFormat
		if apiFormat == "" {
			apiFormat = "openai"
		}
		envKey := ""
		if len(sp.Env) > 0 {
			envKey = sp.Env[0]
		}
		pInfo = append(pInfo, sqlite.ProviderInfo{
			ID:        sp.ID,
			Name:      sp.Name,
			APIBase:   sp.APIBase,
			APIFormat: apiFormat,
			EnvKey:    envKey,
		})
		for _, sm := range sp.Models {
			mInfo = append(mInfo, sqlite.ModelInfo{
				ProviderID:   sp.ID,
				ModelID:      sm.ID,
				Name:         sm.Name,
				ContextLimit: sm.ContextLimit,
				OutputLimit:  sm.OutputLimit,
				Reasoning:    sm.Reasoning,
				ToolCall:     sm.ToolCall,
				Attachment:   sm.Attachment,
			})
		}
	}
	return pInfo, mInfo, nil
}
