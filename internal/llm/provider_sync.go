package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const modelsDevURL = "https://models.dev/api.json"
const syncTimeout = 30 * time.Second

// ModelsDevProvider represents a provider in the models.dev API response.
type ModelsDevProvider struct {
	ID     string                    `json:"id"`
	Name   string                    `json:"name"`
	Env    []string                  `json:"env"`
	API    string                    `json:"api"`
	Doc    string                    `json:"doc"`
	NPM    string                    `json:"npm"`
	Models map[string]ModelsDevModel `json:"models"`
}

// ModelsDevModel represents a model in the models.dev API response.
type ModelsDevModel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Family      string `json:"family"`
	Attachment  bool   `json:"attachment"`
	Reasoning   bool   `json:"reasoning"`
	Temperature bool   `json:"temperature"`
	ToolCall    bool   `json:"tool_call"`
	ReleaseDate string `json:"release_date"`
	Modalities  struct {
		Input  []string `json:"input"`
		Output []string `json:"output"`
	} `json:"modalities"`
	Limit struct {
		Context int `json:"context"`
		Output  int `json:"output"`
	} `json:"limit"`
	Cost *struct {
		Input      float64 `json:"input"`
		Output     float64 `json:"output"`
		CacheRead  float64 `json:"cache_read"`
		CacheWrite float64 `json:"cache_write"`
	} `json:"cost"`
}

// SyncModelsDev fetches provider/model data from models.dev and writes to cache.
func SyncModelsDev(ctx context.Context, db *sqlite.DB) error {
	ctx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()

	log.Printf("syncing provider data from %s", modelsDevURL)

	client := &http.Client{Timeout: syncTimeout}
	req, err := http.NewRequestWithContext(ctx, "GET", modelsDevURL, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "llmwiki/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch models.dev: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("models.dev returned HTTP %d", resp.StatusCode)
	}

	var raw map[string]ModelsDevProvider
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return fmt.Errorf("decode models.dev response: %w", err)
	}

	providers, models := convertModelsDev(raw)

	if len(providers) > 0 {
		if err := db.UpsertProviderInfo(providers); err != nil {
			return fmt.Errorf("upsert providers: %w", err)
		}
	}
	if len(models) > 0 {
		if err := db.UpsertModels(models); err != nil {
			return fmt.Errorf("upsert models: %w", err)
		}
	}

	_ = db.SetConfig("models_synced_at", time.Now().Format(time.RFC3339))
	log.Printf("synced %d providers and %d models from models.dev", len(providers), len(models))
	return nil
}

// convertModelsDev maps raw models.dev data into our cache types.
func convertModelsDev(raw map[string]ModelsDevProvider) ([]sqlite.ProviderInfo, []sqlite.ModelInfo) {
	var providers []sqlite.ProviderInfo
	var models []sqlite.ModelInfo

	for _, p := range raw {
		apiFormat := "openai"
		switch p.ID {
		case "anthropic":
			apiFormat = "anthropic"
		case "ollama":
			apiFormat = "ollama"
		}

		envKey := ""
		if len(p.Env) > 0 {
			envKey = p.Env[0]
		}

		providers = append(providers, sqlite.ProviderInfo{
			ID:        p.ID,
			Name:      p.Name,
			APIBase:   p.API,
			APIFormat: apiFormat,
			EnvKey:    envKey,
			DocURL:    p.Doc,
		})

		for _, m := range p.Models {
			var costInput, costOutput float64
			if m.Cost != nil {
				costInput = m.Cost.Input
				costOutput = m.Cost.Output
			}
			modalities, _ := json.Marshal(m.Modalities)
			models = append(models, sqlite.ModelInfo{
				ProviderID:   p.ID,
				ModelID:      m.ID,
				Name:         m.Name,
				Family:       m.Family,
				ContextLimit: m.Limit.Context,
				OutputLimit:  m.Limit.Output,
				CostInput:    costInput,
				CostOutput:   costOutput,
				Reasoning:    m.Reasoning,
				ToolCall:     m.ToolCall,
				Attachment:   m.Attachment,
				Modalities:   string(modalities),
			})
		}
	}
	return providers, models
}
