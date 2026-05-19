package llm

import (
	"testing"
)

func TestLoadSnapshot(t *testing.T) {
	providers, models, err := LoadSnapshot()
	if err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if len(providers) == 0 {
		t.Fatal("expected at least 1 provider")
	}
	if len(models) == 0 {
		t.Fatal("expected at least 1 model")
	}

	// Verify key providers exist
	found := map[string]bool{}
	for _, p := range providers {
		found[p.ID] = true
	}
	for _, id := range []string{"openai", "anthropic", "ollama", "groq", "deepseek", "google"} {
		if !found[id] {
			t.Errorf("expected provider %q in snapshot", id)
		}
	}

	// Verify provider fields
	for _, p := range providers {
		if p.ID == "" {
			t.Error("provider with empty ID")
		}
		if p.Name == "" {
			t.Errorf("provider %q has empty name", p.ID)
		}
		if p.APIFormat != "openai" && p.APIFormat != "anthropic" && p.APIFormat != "ollama" {
			t.Errorf("provider %q has invalid api_format %q", p.ID, p.APIFormat)
		}
	}

	// Verify specific api_format assignments
	for _, p := range providers {
		switch p.ID {
		case "anthropic":
			if p.APIFormat != "anthropic" {
				t.Errorf("anthropic should be 'anthropic' format, got %q", p.APIFormat)
			}
		case "ollama":
			if p.APIFormat != "ollama" {
				t.Errorf("ollama should be 'ollama' format, got %q", p.APIFormat)
			}
		case "openai":
			if p.APIFormat != "openai" {
				t.Errorf("openai should be 'openai' format, got %q", p.APIFormat)
			}
		}
	}

	// Verify models belong to valid providers
	for _, m := range models {
		if m.ProviderID == "" {
			t.Error("model with empty provider_id")
		}
		if m.ModelID == "" {
			t.Error("model with empty model_id")
		}
		if m.Name == "" {
			t.Errorf("model %s/%s has empty name", m.ProviderID, m.ModelID)
		}
	}

	t.Logf("snapshot has %d providers and %d models", len(providers), len(models))
}

func TestConvertModelsDevAPIFormatMapping(t *testing.T) {
	raw := map[string]ModelsDevProvider{
		"openai":    {ID: "openai", Name: "OpenAI"},
		"anthropic": {ID: "anthropic", Name: "Anthropic"},
		"ollama":    {ID: "ollama", Name: "Ollama"},
		"groq":      {ID: "groq", Name: "Groq"},
		"deepseek":  {ID: "deepseek", Name: "DeepSeek"},
	}

	providers, _ := convertModelsDev(raw)

	formatMap := map[string]string{}
	for _, p := range providers {
		formatMap[p.ID] = p.APIFormat
	}

	if formatMap["anthropic"] != "anthropic" {
		t.Errorf("anthropic format = %q, want 'anthropic'", formatMap["anthropic"])
	}
	if formatMap["ollama"] != "ollama" {
		t.Errorf("ollama format = %q, want 'ollama'", formatMap["ollama"])
	}
	// All others should be openai
	for _, id := range []string{"openai", "groq", "deepseek"} {
		if formatMap[id] != "openai" {
			t.Errorf("%s format = %q, want 'openai'", id, formatMap[id])
		}
	}
}

func TestConvertModelsDevModelParsing(t *testing.T) {
	raw := map[string]ModelsDevProvider{
		"testprov": {
			ID:   "testprov",
			Name: "Test Provider",
			Models: map[string]ModelsDevModel{
				"model-a": {
					ID:       "model-a",
					Name:     "Model A",
					Family:   "test",
					Limit:    struct {
						Context int `json:"context"`
						Output  int `json:"output"`
					}{Context: 128000, Output: 4096},
					Reasoning:  true,
					ToolCall:   true,
					Attachment: false,
				},
			},
		},
	}

	_, models := convertModelsDev(raw)
	if len(models) != 1 {
		t.Fatalf("expected 1 model, got %d", len(models))
	}
	m := models[0]
	if m.ProviderID != "testprov" {
		t.Errorf("provider_id = %q, want 'testprov'", m.ProviderID)
	}
	if m.ModelID != "model-a" {
		t.Errorf("model_id = %q, want 'model-a'", m.ModelID)
	}
	if m.ContextLimit != 128000 {
		t.Errorf("context_limit = %d, want 128000", m.ContextLimit)
	}
	if !m.Reasoning {
		t.Error("reasoning should be true")
	}
}

func TestConvertModelsDevEmptyInput(t *testing.T) {
	providers, models := convertModelsDev(nil)
	if len(providers) != 0 {
		t.Errorf("expected 0 providers, got %d", len(providers))
	}
	if len(models) != 0 {
		t.Errorf("expected 0 models, got %d", len(models))
	}
}
