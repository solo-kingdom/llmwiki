package llm

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type WorkspaceConfig struct {
	Provider          string `json:"provider"`
	APIKey            string `json:"api_key"`
	Model             string `json:"model"`
	BaseURL           string `json:"base_url"`
	RequestTimeout    int    `json:"request_timeout"`
	StreamIdleTimeout int    `json:"stream_idle_timeout"`
}

func DefaultWorkspaceConfig() WorkspaceConfig {
	return WorkspaceConfig{
		Provider:          "openai",
		Model:             "gpt-4o",
		RequestTimeout:    1800,
		StreamIdleTimeout: 120,
	}
}

func LoadConfig(workspaceDir string) (WorkspaceConfig, error) {
	cfg := DefaultWorkspaceConfig()

	path := filepath.Join(workspaceDir, ".llmwiki", "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return cfg, err
		}
	} else {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return cfg, err
		}
	}

	if cfg.Provider == "" {
		cfg.Provider = envOr("LLMWIKI_PROVIDER", cfg.Provider)
	}
	if cfg.APIKey == "" {
		cfg.APIKey = envOr("LLMWIKI_API_KEY",
			envOr("OPENAI_API_KEY",
				envOr("ANTHROPIC_API_KEY", cfg.APIKey)))
	}
	if cfg.Model == "" {
		cfg.Model = envOr("LLMWIKI_MODEL", cfg.Model)
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = envOr("LLMWIKI_BASE_URL", cfg.BaseURL)
	}

	return cfg, nil
}

func SaveConfig(workspaceDir string, cfg WorkspaceConfig) error {
	dir := filepath.Join(workspaceDir, ".llmwiki")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(dir, "config.json"), data, 0o644)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type ConfigManager struct {
	mu           sync.RWMutex
	config       WorkspaceConfig
	workspaceDir string
	client       *Client
}

func NewConfigManager(workspaceDir string) (*ConfigManager, error) {
	cfg, err := LoadConfig(workspaceDir)
	if err != nil {
		return nil, err
	}
	cm := &ConfigManager{
		config:       cfg,
		workspaceDir: workspaceDir,
	}
	cm.client = NewClient(cm.toClientConfig())
	return cm, nil
}

func (cm *ConfigManager) toClientConfig() Config {
	cfg := cm.config
	timeout := time.Duration(cfg.RequestTimeout) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Minute
	}
	streamIdle := time.Duration(cfg.StreamIdleTimeout) * time.Second
	if streamIdle == 0 {
		streamIdle = 2 * time.Minute
	}
	return Config{
		Provider:          cfg.Provider,
		BaseURL:           cfg.BaseURL,
		APIKey:            cfg.APIKey,
		Model:             cfg.Model,
		Timeout:           timeout,
		StreamIdleTimeout: streamIdle,
	}
}

func (cm *ConfigManager) ReloadConfig() error {
	cfg, err := LoadConfig(cm.workspaceDir)
	if err != nil {
		return err
	}
	cm.mu.Lock()
	cm.config = cfg
	cm.client = NewClient(cm.toClientConfig())
	cm.mu.Unlock()
	return nil
}

func (cm *ConfigManager) GetClient() *Client {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.client
}

func (cm *ConfigManager) GetConfig() WorkspaceConfig {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.config
}

func (cm *ConfigManager) UpdateConfig(cfg WorkspaceConfig) error {
	if err := SaveConfig(cm.workspaceDir, cfg); err != nil {
		return err
	}
	return cm.ReloadConfig()
}
