package llm

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultWorkspaceConfig(t *testing.T) {
	cfg := DefaultWorkspaceConfig()
	if cfg.Provider != "openai" {
		t.Errorf("expected provider 'openai', got %q", cfg.Provider)
	}
	if cfg.Model != "gpt-4o" {
		t.Errorf("expected model 'gpt-4o', got %q", cfg.Model)
	}
	if cfg.RequestTimeout != 1800 {
		t.Errorf("expected request_timeout 1800, got %d", cfg.RequestTimeout)
	}
	if cfg.StreamIdleTimeout != 120 {
		t.Errorf("expected stream_idle_timeout 120, got %d", cfg.StreamIdleTimeout)
	}
}

func TestLoadConfigNoFile(t *testing.T) {
	dir := t.TempDir()

	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.Provider != "openai" {
		t.Errorf("expected default provider 'openai', got %q", cfg.Provider)
	}
	if cfg.Model != "gpt-4o" {
		t.Errorf("expected default model 'gpt-4o', got %q", cfg.Model)
	}
}

func TestLoadConfigFromFile(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, ".llmwiki")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	fileCfg := WorkspaceConfig{
		Provider:          "anthropic",
		APIKey:            "sk-test-key",
		Model:             "claude-3",
		BaseURL:           "https://api.anthropic.com",
		RequestTimeout:    900,
		StreamIdleTimeout: 60,
	}
	data, _ := json.MarshalIndent(fileCfg, "", "  ")
	if err := os.WriteFile(filepath.Join(configDir, "config.json"), data, 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.Provider != "anthropic" {
		t.Errorf("expected provider 'anthropic', got %q", cfg.Provider)
	}
	if cfg.Model != "claude-3" {
		t.Errorf("expected model 'claude-3', got %q", cfg.Model)
	}
	if cfg.APIKey != "sk-test-key" {
		t.Errorf("expected api_key 'sk-test-key', got %q", cfg.APIKey)
	}
}

func TestSaveConfig(t *testing.T) {
	dir := t.TempDir()

	cfg := WorkspaceConfig{
		Provider: "openai",
		APIKey:   "test-key",
		Model:    "gpt-4o",
	}

	if err := SaveConfig(dir, cfg); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, ".llmwiki", "config.json"))
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}

	var loaded WorkspaceConfig
	if err := json.Unmarshal(data, &loaded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if loaded.Provider != "openai" {
		t.Errorf("expected provider 'openai', got %q", loaded.Provider)
	}
	if loaded.APIKey != "test-key" {
		t.Errorf("expected api_key 'test-key', got %q", loaded.APIKey)
	}
}

func TestLoadConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()

	original := WorkspaceConfig{
		Provider:          "ollama",
		APIKey:            "",
		Model:             "llama3",
		BaseURL:           "http://localhost:11434",
		RequestTimeout:    600,
		StreamIdleTimeout: 30,
	}

	if err := SaveConfig(dir, original); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	loaded, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if loaded.Provider != original.Provider {
		t.Errorf("provider: got %q, want %q", loaded.Provider, original.Provider)
	}
	if loaded.Model != original.Model {
		t.Errorf("model: got %q, want %q", loaded.Model, original.Model)
	}
	if loaded.BaseURL != original.BaseURL {
		t.Errorf("base_url: got %q, want %q", loaded.BaseURL, original.BaseURL)
	}
}

func TestLoadConfigEnvFallback(t *testing.T) {
	dir := t.TempDir()

	os.Setenv("LLMWIKI_API_KEY", "env-api-key")
	defer os.Unsetenv("LLMWIKI_API_KEY")

	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.APIKey != "env-api-key" {
		t.Errorf("expected api_key from env 'env-api-key', got %q", cfg.APIKey)
	}
}

func TestLoadConfigOpenAIKeyFallback(t *testing.T) {
	dir := t.TempDir()

	os.Setenv("OPENAI_API_KEY", "openai-key")
	defer os.Unsetenv("OPENAI_API_KEY")

	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.APIKey != "openai-key" {
		t.Errorf("expected api_key from OPENAI_API_KEY fallback, got %q", cfg.APIKey)
	}
}

func TestLoadConfigAnthropicKeyFallback(t *testing.T) {
	dir := t.TempDir()

	os.Setenv("ANTHROPIC_API_KEY", "anthropic-key")
	defer os.Unsetenv("ANTHROPIC_API_KEY")

	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.APIKey != "anthropic-key" {
		t.Errorf("expected api_key from ANTHROPIC_API_KEY fallback, got %q", cfg.APIKey)
	}
}

func TestLoadConfigProviderEnvFallback(t *testing.T) {
	dir := t.TempDir()

	fileCfg := WorkspaceConfig{Provider: ""}
	data, _ := json.Marshal(fileCfg)
	configDir := filepath.Join(dir, ".llmwiki")
	os.MkdirAll(configDir, 0755)
	os.WriteFile(filepath.Join(configDir, "config.json"), data, 0644)

	os.Setenv("LLMWIKI_PROVIDER", "anthropic")
	defer os.Unsetenv("LLMWIKI_PROVIDER")

	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.Provider != "anthropic" {
		t.Errorf("expected provider from env 'anthropic', got %q", cfg.Provider)
	}
}

func TestConfigManagerReload(t *testing.T) {
	dir := t.TempDir()

	cfg1 := WorkspaceConfig{
		Provider: "openai",
		Model:    "gpt-4o",
	}
	if err := SaveConfig(dir, cfg1); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	cm, err := NewConfigManager(dir)
	if err != nil {
		t.Fatalf("NewConfigManager() error = %v", err)
	}

	got := cm.GetConfig()
	if got.Model != "gpt-4o" {
		t.Errorf("expected model 'gpt-4o', got %q", got.Model)
	}

	cfg2 := WorkspaceConfig{
		Provider: "anthropic",
		Model:    "claude-3",
	}
	if err := cm.UpdateConfig(cfg2); err != nil {
		t.Fatalf("UpdateConfig() error = %v", err)
	}

	reloaded := cm.GetConfig()
	if reloaded.Model != "claude-3" {
		t.Errorf("expected model 'claude-3' after reload, got %q", reloaded.Model)
	}
	if reloaded.Provider != "anthropic" {
		t.Errorf("expected provider 'anthropic' after reload, got %q", reloaded.Provider)
	}
}

func TestConfigManagerGetClient(t *testing.T) {
	dir := t.TempDir()

	cfg := WorkspaceConfig{
		Provider: "openai",
		Model:    "gpt-4o",
	}
	SaveConfig(dir, cfg)

	cm, err := NewConfigManager(dir)
	if err != nil {
		t.Fatalf("NewConfigManager() error = %v", err)
	}

	client := cm.GetClient()
	if client == nil {
		t.Error("expected non-nil client")
	}
}

func TestEnvOr(t *testing.T) {
	if got := envOr("NONEXISTENT_VAR_12345", "fallback"); got != "fallback" {
		t.Errorf("expected 'fallback', got %q", got)
	}

	os.Setenv("TEST_ENV_OR_VAR", "from-env")
	defer os.Unsetenv("TEST_ENV_OR_VAR")

	if got := envOr("TEST_ENV_OR_VAR", "fallback"); got != "from-env" {
		t.Errorf("expected 'from-env', got %q", got)
	}
}

func TestLoadConfigPriorityFileOverEnv(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, ".llmwiki")
	os.MkdirAll(configDir, 0755)

	fileCfg := WorkspaceConfig{
		Provider:       "ollama",
		APIKey:         "file-key",
		Model:          "file-model",
		BaseURL:        "http://file-url",
		RequestTimeout: 100,
	}
	data, _ := json.Marshal(fileCfg)
	os.WriteFile(filepath.Join(configDir, "config.json"), data, 0644)

	os.Setenv("LLMWIKI_API_KEY", "env-key-should-lose")
	defer os.Unsetenv("LLMWIKI_API_KEY")

	cfg, err := LoadConfig(dir)
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.APIKey != "file-key" {
		t.Errorf("expected file key 'file-key' to win over env, got %q", cfg.APIKey)
	}
}

// --- Provider extensibility tests (per llm-config-management spec) ---
// These verify that new provider types can be added via UI config
// without requiring startup command flag changes.

func TestProviderExtensibility_NewProviderViaConfig(t *testing.T) {
	dir := t.TempDir()

	// Simulate adding a new provider (e.g., "deepseek") via UI config file
	newProvider := WorkspaceConfig{
		Provider:          "deepseek",
		APIKey:            "ds-test-key",
		Model:             "deepseek-chat",
		BaseURL:           "https://api.deepseek.com/v1",
		RequestTimeout:    600,
		StreamIdleTimeout: 60,
	}
	if err := SaveConfig(dir, newProvider); err != nil {
		t.Fatalf("SaveConfig() for new provider: %v", err)
	}

	cm, err := NewConfigManager(dir)
	if err != nil {
		t.Fatalf("NewConfigManager() for new provider: %v", err)
	}

	cfg := cm.GetConfig()
	if cfg.Provider != "deepseek" {
		t.Errorf("expected provider 'deepseek', got %q", cfg.Provider)
	}
	if cfg.Model != "deepseek-chat" {
		t.Errorf("expected model 'deepseek-chat', got %q", cfg.Model)
	}
	if cfg.BaseURL != "https://api.deepseek.com/v1" {
		t.Errorf("expected base URL 'https://api.deepseek.com/v1', got %q", cfg.BaseURL)
	}

	// Client should be created without errors
	client := cm.GetClient()
	if client == nil {
		t.Error("expected non-nil client for new provider")
	}
}

func TestProviderExtensibility_ConfigChangeWithoutRestart(t *testing.T) {
	dir := t.TempDir()

	// Start with one provider
	initial := WorkspaceConfig{
		Provider: "openai",
		APIKey:   "openai-key",
		Model:    "gpt-4o",
	}
	SaveConfig(dir, initial)

	cm, _ := NewConfigManager(dir)

	// Verify initial provider
	cfg := cm.GetConfig()
	if cfg.Provider != "openai" {
		t.Fatalf("initial provider: got %q, want 'openai'", cfg.Provider)
	}

	// Switch to a new provider via UpdateConfig (simulates UI change)
	updated := WorkspaceConfig{
		Provider:          "groq",
		APIKey:            "groq-key",
		Model:             "llama-3.1-70b",
		BaseURL:           "https://api.groq.com/openai/v1",
		RequestTimeout:    300,
		StreamIdleTimeout: 45,
	}
	if err := cm.UpdateConfig(updated); err != nil {
		t.Fatalf("UpdateConfig() to new provider: %v", err)
	}

	// Verify config was updated without restart
	cfg = cm.GetConfig()
	if cfg.Provider != "groq" {
		t.Errorf("expected provider 'groq' after update, got %q", cfg.Provider)
	}
	if cfg.Model != "llama-3.1-70b" {
		t.Errorf("expected model 'llama-3.1-70b' after update, got %q", cfg.Model)
	}
	if cfg.RequestTimeout != 300 {
		t.Errorf("expected request_timeout 300, got %d", cfg.RequestTimeout)
	}
	if cfg.StreamIdleTimeout != 45 {
		t.Errorf("expected stream_idle_timeout 45, got %d", cfg.StreamIdleTimeout)
	}

	// New client should reflect new config
	client := cm.GetClient()
	if client == nil {
		t.Error("expected non-nil client after provider switch")
	}
}

func TestProviderExtensibility_TimeoutConfigurable(t *testing.T) {
	dir := t.TempDir()

	cfg := WorkspaceConfig{
		Provider:          "openai",
		Model:             "gpt-4o",
		RequestTimeout:    42,
		StreamIdleTimeout: 7,
	}
	SaveConfig(dir, cfg)

	cm, _ := NewConfigManager(dir)

	got := cm.GetConfig()
	if got.RequestTimeout != 42 {
		t.Errorf("expected request_timeout 42, got %d", got.RequestTimeout)
	}
	if got.StreamIdleTimeout != 7 {
		t.Errorf("expected stream_idle_timeout 7, got %d", got.StreamIdleTimeout)
	}
}
