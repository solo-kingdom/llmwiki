package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

const (
	ConfigEmbeddingInstanceID = "embedding_instance_id"
	ConfigEmbeddingModel      = "embedding_model"
	ConfigEmbeddingDim        = "embedding_dim"
)

// EmbeddingSettings describes the configured embedding provider.
type EmbeddingSettings struct {
	InstanceID string
	Model      string
	Dim        int
}

// LoadEmbeddingSettings reads embedding configuration from app_config.
func LoadEmbeddingSettings(db store.Store) (EmbeddingSettings, error) {
	if db == nil {
		return EmbeddingSettings{}, fmt.Errorf("no database")
	}
	inst, _ := db.GetConfig(ConfigEmbeddingInstanceID)
	model, _ := db.GetConfig(ConfigEmbeddingModel)
	dimRaw, _ := db.GetConfig(ConfigEmbeddingDim)
	settings := EmbeddingSettings{
		InstanceID: strings.TrimSpace(inst),
		Model:      strings.TrimSpace(model),
	}
	if settings.InstanceID == "" || settings.Model == "" {
		return settings, fmt.Errorf("embedding is not configured: set %s and %s in Settings", ConfigEmbeddingInstanceID, ConfigEmbeddingModel)
	}
	if dimRaw != "" {
		var dim int
		if _, err := fmt.Sscanf(dimRaw, "%d", &dim); err == nil && dim > 0 {
			settings.Dim = dim
		}
	}
	return settings, nil
}

// EmbeddingClient builds a client for the configured embedding provider.
func EmbeddingClient(db store.Store) (*Client, EmbeddingSettings, error) {
	settings, err := LoadEmbeddingSettings(db)
	if err != nil {
		return nil, settings, err
	}
	client, err := ClientFromInstance(db, settings.InstanceID, settings.Model)
	if err != nil {
		return nil, settings, err
	}
	if client.config.Provider != "openai" {
		return nil, settings, fmt.Errorf("embeddings require an OpenAI-compatible provider, got %q", client.config.Provider)
	}
	return client, settings, nil
}

type embeddingRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type embeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Embeddings calls the OpenAI-compatible /embeddings endpoint.
func (c *Client) Embeddings(ctx context.Context, model string, input []string) ([][]float32, error) {
	if len(input) == 0 {
		return nil, nil
	}
	if model == "" {
		model = c.config.Model
	}
	body, err := json.Marshal(embeddingRequest{Model: model, Input: input})
	if err != nil {
		return nil, fmt.Errorf("marshal embeddings request: %w", err)
	}
	url := strings.TrimRight(c.config.BaseURL, "/") + "/embeddings"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create embeddings request: %w", err)
	}
	c.setHeaders(req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("send embeddings request: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("read embeddings response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("embeddings API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var parsed embeddingResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, fmt.Errorf("decode embeddings response: %w", err)
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("embeddings API error: %s", parsed.Error.Message)
	}
	if len(parsed.Data) != len(input) {
		return nil, fmt.Errorf("embeddings API returned %d vectors for %d inputs", len(parsed.Data), len(input))
	}
	out := make([][]float32, len(parsed.Data))
	for i, item := range parsed.Data {
		idx := item.Index
		if idx < 0 || idx >= len(out) {
			idx = i
		}
		out[idx] = item.Embedding
	}
	return out, nil
}
