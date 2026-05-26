package llm

import (
	"fmt"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const defaultRequestTimeout = 30 * time.Minute
const defaultStreamIdleTimeout = 2 * time.Minute

// ClientFromInstance builds an LLM client from a provider instance and model name.
// Instance base_url takes precedence over catalog api_base.
func ClientFromInstance(db *sqlite.DB, instanceID, model string) (*Client, error) {
	instanceID = strings.TrimSpace(instanceID)
	model = strings.TrimSpace(model)
	if instanceID == "" || model == "" {
		return nil, fmt.Errorf(
			"provider instance and model are not configured; set them in Settings under Provider instances",
		)
	}

	inst, err := db.GetProviderInstance(instanceID)
	if err != nil {
		return nil, fmt.Errorf("load provider instance: %w", err)
	}
	if inst == nil {
		return nil, fmt.Errorf(
			"provider instance %q not found; configure it in Settings under Provider instances",
			instanceID,
		)
	}
	if strings.TrimSpace(inst.APIKey) == "" {
		name := inst.Name
		if name == "" {
			name = instanceID
		}
		return nil, fmt.Errorf(
			"API key is not configured for provider instance %q; set it in Settings under Provider instances",
			name,
		)
	}

	apiFormat := "openai"
	baseURL := inst.BaseURL
	pInfo, _ := db.GetProviderInfo(inst.CatalogID)
	if pInfo != nil {
		if pInfo.APIFormat != "" {
			apiFormat = pInfo.APIFormat
		}
		if baseURL == "" {
			baseURL = pInfo.APIBase
		}
	}

	return newValidatedClient(Config{
		Provider:          apiFormat,
		BaseURL:           baseURL,
		APIKey:            inst.APIKey,
		Model:             model,
		Timeout:           defaultRequestTimeout,
		StreamIdleTimeout: defaultStreamIdleTimeout,
	})
}

// ClientFromWorkspace builds an LLM client from legacy workspace .llmwiki/config.json.
func ClientFromWorkspace(workspace string) (*Client, error) {
	if strings.TrimSpace(workspace) == "" {
		return nil, fmt.Errorf(
			"provider instance and model are not configured; set them in Settings under Provider instances",
		)
	}

	wsCfg, err := LoadConfig(workspace)
	if err != nil {
		return nil, fmt.Errorf("load workspace LLM config: %w", err)
	}

	timeout := time.Duration(wsCfg.RequestTimeout) * time.Second
	if timeout == 0 {
		timeout = defaultRequestTimeout
	}
	streamIdle := time.Duration(wsCfg.StreamIdleTimeout) * time.Second
	if streamIdle == 0 {
		streamIdle = defaultStreamIdleTimeout
	}

	return newValidatedClient(Config{
		Provider:          wsCfg.Provider,
		BaseURL:           wsCfg.BaseURL,
		APIKey:            wsCfg.APIKey,
		Model:             wsCfg.Model,
		Timeout:           timeout,
		StreamIdleTimeout: streamIdle,
	})
}

func newValidatedClient(cfg Config) (*Client, error) {
	client := NewClient(cfg)
	if err := client.validateRequest(); err != nil {
		return nil, err
	}
	return client, nil
}
