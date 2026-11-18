package postgres_test

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestProviderCacheReplace(t *testing.T) {
	db := pgtest.Open(t)

	empty, err := db.CacheIsEmpty()
	if err != nil || !empty {
		t.Fatalf("CacheIsEmpty = %v, %v; want true, nil", empty, err)
	}
	if _, err := db.GetProviderInfo("openai"); err != nil {
		t.Fatalf("GetProviderInfo empty: %v", err)
	} else if p, _ := db.GetProviderInfo("openai"); p != nil {
		t.Fatalf("GetProviderInfo empty = %+v, want nil", p)
	}

	providers := []store.ProviderInfo{
		{ID: "openai", Name: "OpenAI", APIBase: "https://api.openai.com/v1", APIFormat: "openai", EnvKey: "OPENAI_API_KEY"},
		{ID: "anthropic", Name: "Anthropic", APIBase: "https://api.anthropic.com", APIFormat: "anthropic"},
	}
	if err := db.UpsertProviderInfo(providers); err != nil {
		t.Fatalf("UpsertProviderInfo: %v", err)
	}
	empty, err = db.CacheIsEmpty()
	if err != nil || empty {
		t.Fatalf("CacheIsEmpty after upsert = %v, %v; want false, nil", empty, err)
	}
	list, err := db.ListProviders()
	if err != nil {
		t.Fatalf("ListProviders: %v", err)
	}
	if len(list) != 2 || list[0].ID != "anthropic" {
		t.Fatalf("ListProviders = %+v, want 2 rows ordered by name", list)
	}
	info, err := db.GetProviderInfo("openai")
	if err != nil || info == nil {
		t.Fatalf("GetProviderInfo = %+v, %v", info, err)
	}
	if info.APIFormat != "openai" || info.EnvKey != "OPENAI_API_KEY" {
		t.Fatalf("unexpected provider info: %+v", info)
	}

	// Replacing the cache drops providers that are no longer present.
	if err := db.UpsertProviderInfo([]store.ProviderInfo{{ID: "ollama", Name: "Ollama", APIFormat: "ollama"}}); err != nil {
		t.Fatalf("UpsertProviderInfo replace: %v", err)
	}
	list, err = db.ListProviders()
	if err != nil || len(list) != 1 || list[0].ID != "ollama" {
		t.Fatalf("ListProviders after replace = %+v, %v", list, err)
	}

	models := []store.ModelInfo{
		{ProviderID: "ollama", ModelID: "llama3", Name: "Llama 3", Family: "llama", ContextLimit: 8192, OutputLimit: 2048, CostInput: 0.1, CostOutput: 0.2, Reasoning: true, ToolCall: true, Attachment: false, Modalities: `{"text":true}`},
		{ProviderID: "ollama", ModelID: "qwen", Name: "Qwen", ContextLimit: 4096},
		{ProviderID: "other", ModelID: "m1", Name: "M1"},
	}
	if err := db.UpsertModels(models); err != nil {
		t.Fatalf("UpsertModels: %v", err)
	}
	got, err := db.ListModelsByProvider("ollama")
	if err != nil {
		t.Fatalf("ListModelsByProvider: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("ListModelsByProvider len = %d, want 2", len(got))
	}
	if got[0].Name != "Llama 3" || !got[0].Reasoning || !got[0].ToolCall || got[0].Attachment {
		t.Fatalf("unexpected first model: %+v", got[0])
	}

	// Only the listed provider's models are replaced.
	if err := db.UpsertModels([]store.ModelInfo{{ProviderID: "ollama", ModelID: "llama3", Name: "Llama 3.1"}}); err != nil {
		t.Fatalf("UpsertModels replace: %v", err)
	}
	got, _ = db.ListModelsByProvider("ollama")
	if len(got) != 1 || got[0].Name != "Llama 3.1" {
		t.Fatalf("ListModelsByProvider after replace = %+v", got)
	}
	other, _ := db.ListModelsByProvider("other")
	if len(other) != 1 {
		t.Fatalf("other provider models = %+v, want untouched", other)
	}
}
