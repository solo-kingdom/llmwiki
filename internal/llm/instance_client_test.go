package llm

import (
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func openInstanceTestDB(t *testing.T) *sqlite.DB {
	t.Helper()
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func seedOpenAIProvider(t *testing.T, db *sqlite.DB) {
	t.Helper()
	if err := db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{
			ID:        "openai",
			Name:      "OpenAI",
			APIBase:   "https://api.openai.com/v1",
			APIFormat: "openai",
			EnvKey:    "OPENAI_API_KEY",
		},
	}); err != nil {
		t.Fatalf("UpsertProviderInfo: %v", err)
	}
}

func TestClientFromInstanceUsesCatalogBaseURL(t *testing.T) {
	db := openInstanceTestDB(t)
	seedOpenAIProvider(t, db)

	inst := &sqlite.ProviderInstance{
		Name:      "OpenAI Work",
		CatalogID: "openai",
		APIKey:    "sk-test-key",
	}
	if err := db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}

	client, err := ClientFromInstance(db, inst.ID, "gpt-4o")
	if err != nil {
		t.Fatalf("ClientFromInstance: %v", err)
	}
	if client == nil {
		t.Fatal("expected client")
	}
	if client.config.BaseURL != "https://api.openai.com/v1" {
		t.Fatalf("base URL = %q, want catalog default", client.config.BaseURL)
	}
}

func TestClientFromInstancePrefersInstanceBaseURL(t *testing.T) {
	db := openInstanceTestDB(t)
	seedOpenAIProvider(t, db)

	inst := &sqlite.ProviderInstance{
		Name:      "Custom Gateway",
		CatalogID: "openai",
		APIKey:    "sk-test-key",
		BaseURL:   "https://proxy.example.com/v1",
	}
	if err := db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}

	client, err := ClientFromInstance(db, inst.ID, "gpt-4o")
	if err != nil {
		t.Fatalf("ClientFromInstance: %v", err)
	}
	if client.config.BaseURL != "https://proxy.example.com/v1" {
		t.Fatalf("base URL = %q, want instance override", client.config.BaseURL)
	}
}

func TestClientFromInstanceMissingBaseURL(t *testing.T) {
	db := openInstanceTestDB(t)
	if err := db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{ID: "custom", Name: "Custom", APIFormat: "openai"},
	}); err != nil {
		t.Fatalf("UpsertProviderInfo: %v", err)
	}

	inst := &sqlite.ProviderInstance{
		Name:      "Custom",
		CatalogID: "custom",
		APIKey:    "sk-test-key",
	}
	if err := db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}

	_, err := ClientFromInstance(db, inst.ID, "gpt-4o")
	if err == nil {
		t.Fatal("expected error for missing base URL")
	}
	if !strings.Contains(err.Error(), "base URL is not configured") {
		t.Fatalf("error = %q, want base URL message", err.Error())
	}
}

func TestClientFromInstanceMissingAPIKey(t *testing.T) {
	db := openInstanceTestDB(t)
	seedOpenAIProvider(t, db)

	inst := &sqlite.ProviderInstance{
		Name:      "OpenAI Work",
		CatalogID: "openai",
	}
	if err := db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}

	_, err := ClientFromInstance(db, inst.ID, "gpt-4o")
	if err == nil {
		t.Fatal("expected error for missing API key")
	}
	if !strings.Contains(err.Error(), "API key is not configured") {
		t.Fatalf("error = %q, want API key message", err.Error())
	}
}

func TestClientFromWorkspace(t *testing.T) {
	ws := t.TempDir()
	if err := SaveConfig(ws, WorkspaceConfig{
		Provider: "openai",
		APIKey:   "sk-test",
		Model:    "gpt-4o",
		BaseURL:  "https://api.openai.com/v1",
	}); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	client, err := ClientFromWorkspace(ws)
	if err != nil {
		t.Fatalf("ClientFromWorkspace: %v", err)
	}
	if client.config.Model != "gpt-4o" {
		t.Fatalf("model = %q, want gpt-4o", client.config.Model)
	}
}

func TestClientFromWorkspaceMissingConfig(t *testing.T) {
	for _, key := range []string{
		"LLMWIKI_BASE_URL", "LLMWIKI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
	} {
		t.Setenv(key, "")
	}

	ws := t.TempDir()
	_, err := ClientFromWorkspace(ws)
	if err == nil {
		t.Fatal("expected error for empty workspace config")
	}
	if !strings.Contains(err.Error(), "base URL is not configured") {
		t.Fatalf("error = %q, want base URL message", err.Error())
	}
}
