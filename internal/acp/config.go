package acp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	ConfigVersion              = 1
	KindNative                 = "native"
	KindACP                    = "acp"
	DefaultCWDPolicy           = "workspace"
	DefaultInitTimeoutMS       = 30000
	DefaultPromptTimeoutMS     = 600000
	DefaultIdleTimeoutMS       = 120000
	DefaultReadonlyOnly        = true
	DefaultOnUnavailable       = "error"
	DefaultMaxConcurrentAgents = 4

	MinInitTimeoutMS   = 1000
	MaxInitTimeoutMS   = 120000
	MinPromptTimeoutMS = 5000
	MaxPromptTimeoutMS = 3600000
	MinIdleTimeoutMS   = 5000
	MaxIdleTimeoutMS   = 600000

	MinConcurrentAgents = 1
	MaxConcurrentAgents = 16
)

var envNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Config is the root ACP agent configuration stored in app_config.
type Config struct {
	Version  int                    `json:"version"`
	Agents   map[string]AgentConfig `json:"agents"`
	Defaults Defaults               `json:"defaults"`
}

// AgentConfig describes how to launch one generic ACP agent. It intentionally
// has no field capable of storing environment variable values.
type AgentConfig struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Enabled         bool             `json:"enabled"`
	Command         string           `json:"command"`
	Args            []string         `json:"args,omitempty"`
	EnvPassthrough  []string         `json:"env_passthrough,omitempty"`
	CWDPolicy       string           `json:"cwd_policy"`
	InitTimeoutMS   int              `json:"init_timeout_ms"`
	PromptTimeoutMS int              `json:"prompt_timeout_ms"`
	IdleTimeoutMS   int              `json:"idle_timeout_ms"`
	Permission      PermissionPolicy `json:"permission"`
}

type PermissionPolicy struct {
	Mode         string `json:"mode"`
	AllowRead    bool   `json:"allow_read"`
	AllowSearch  bool   `json:"allow_search"`
	AllowFetch   bool   `json:"allow_fetch"`
	AllowWrite   bool   `json:"allow_write"`
	AllowExecute bool   `json:"allow_execute"`
}

type Defaults struct {
	ReadonlyOnly  bool   `json:"readonly_only"`
	OnUnavailable string `json:"on_unavailable"`
}

type ValidationError struct {
	Path    string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Path != "" {
		return fmt.Sprintf("%s: %s", e.Path, e.Message)
	}
	return e.Message
}

func ve(path, msg string) error {
	return &ValidationError{Path: path, Message: msg}
}

func DefaultConfig() *Config {
	return &Config{
		Version: ConfigVersion,
		Agents:  map[string]AgentConfig{},
		Defaults: Defaults{
			ReadonlyOnly:  DefaultReadonlyOnly,
			OnUnavailable: DefaultOnUnavailable,
		},
	}
}

// ParseConfig parses, validates, and applies defaults to an ACP config document.
func ParseConfig(raw string) (*Config, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultConfig(), nil
	}

	var envelope struct {
		Version  int             `json:"version"`
		Agents   json.RawMessage `json:"agents"`
		Defaults json.RawMessage `json:"defaults"`
	}
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
		return nil, ve("", fmt.Sprintf("invalid JSON: %v", err))
	}

	agents, err := parseAgents(envelope.Agents)
	if err != nil {
		return nil, err
	}
	cfg := &Config{Version: envelope.Version, Agents: agents, Defaults: Defaults{ReadonlyOnly: DefaultReadonlyOnly}}

	if len(envelope.Defaults) > 0 && strings.TrimSpace(string(envelope.Defaults)) != "null" {
		var defaults struct {
			ReadonlyOnly  *bool  `json:"readonly_only"`
			OnUnavailable string `json:"on_unavailable"`
		}
		if err := json.Unmarshal(envelope.Defaults, &defaults); err != nil {
			return nil, ve("defaults", fmt.Sprintf("invalid object: %v", err))
		}
		if defaults.ReadonlyOnly != nil {
			cfg.Defaults.ReadonlyOnly = *defaults.ReadonlyOnly
		}
		cfg.Defaults.OnUnavailable = defaults.OnUnavailable
	}

	if err := ValidateConfig(cfg); err != nil {
		return nil, err
	}
	ApplyDefaultsAfterParse(cfg)
	return cfg, nil
}

func parseAgents(raw json.RawMessage) (map[string]AgentConfig, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return map[string]AgentConfig{}, nil
	}
	if trimmed[0] != '{' {
		return nil, ve("agents", "must be an object keyed by agent id")
	}

	var agentsRaw map[string]json.RawMessage
	if err := json.Unmarshal(raw, &agentsRaw); err != nil {
		return nil, ve("agents", fmt.Sprintf("invalid object: %v", err))
	}
	agents := make(map[string]AgentConfig, len(agentsRaw))
	for id, agentRaw := range agentsRaw {
		if id == "" {
			return nil, ve("agents", "empty agent key")
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(agentRaw, &fields); err != nil {
			path := fmt.Sprintf("agents.%s", id)
			return nil, ve(path, fmt.Sprintf("invalid object: %v", err))
		}
		if _, ok := fields["env"]; ok {
			return nil, ve(fmt.Sprintf("agents.%s.env", id), "配置不接受环境变量值，请用 env_passthrough 只声明变量名")
		}
		var agent AgentConfig
		if err := json.Unmarshal(agentRaw, &agent); err != nil {
			path := fmt.Sprintf("agents.%s", id)
			return nil, ve(path, fmt.Sprintf("invalid agent: %v", err))
		}
		agents[id] = agent
	}
	return agents, nil
}

// ValidateConfig checks structural, path, timeout, and credential boundaries.
func ValidateConfig(cfg *Config) error {
	if cfg == nil {
		return ve("", "config is nil")
	}
	if cfg.Version != ConfigVersion {
		return ve("version", fmt.Sprintf("must be %d", ConfigVersion))
	}
	if cfg.Defaults.OnUnavailable != "" && cfg.Defaults.OnUnavailable != DefaultOnUnavailable {
		return ve("defaults.on_unavailable", "must be error")
	}
	for id, agent := range cfg.Agents {
		if strings.TrimSpace(id) == "" {
			return ve("agents", "empty agent key")
		}
		prefix := fmt.Sprintf("agents.%s", id)
		if agent.ID == "" {
			return ve(prefix+".id", fmt.Sprintf("must match map key %q", id))
		}
		if agent.ID != id {
			return ve(prefix+".id", fmt.Sprintf("must match map key %q", id))
		}
		if strings.TrimSpace(agent.Name) == "" {
			return ve(prefix+".name", "is required")
		}
		if err := validateCommand(agent.Command, prefix+".command"); err != nil {
			return err
		}
		if err := validateArgsNoCredentials(id, agent.Args); err != nil {
			return err
		}
		seenEnv := make(map[string]bool, len(agent.EnvPassthrough))
		for i, name := range agent.EnvPassthrough {
			path := fmt.Sprintf("%s.env_passthrough[%d]", prefix, i)
			if name == "" {
				return ve(path, "environment variable name is required")
			}
			if !envNamePattern.MatchString(name) {
				return ve(path, "must match ^[A-Za-z_][A-Za-z0-9_]*$")
			}
			if seenEnv[name] {
				return ve(path, fmt.Sprintf("duplicate environment variable name %q", name))
			}
			seenEnv[name] = true
		}
		if agent.CWDPolicy != "" && agent.CWDPolicy != "workspace" && agent.CWDPolicy != "session" {
			return ve(prefix+".cwd_policy", "must be workspace or session")
		}
		if err := validateTimeout(agent.InitTimeoutMS, MinInitTimeoutMS, MaxInitTimeoutMS, prefix+".init_timeout_ms"); err != nil {
			return err
		}
		if err := validateTimeout(agent.PromptTimeoutMS, MinPromptTimeoutMS, MaxPromptTimeoutMS, prefix+".prompt_timeout_ms"); err != nil {
			return err
		}
		if err := validateTimeout(agent.IdleTimeoutMS, MinIdleTimeoutMS, MaxIdleTimeoutMS, prefix+".idle_timeout_ms"); err != nil {
			return err
		}
		if agent.Permission.Mode != "" && agent.Permission.Mode != "auto" {
			return ve(prefix+".permission.mode", "must be auto")
		}
		if cfg.Defaults.ReadonlyOnly && (agent.Permission.AllowWrite || agent.Permission.AllowExecute) {
			return ve(prefix+".permission", "allow_write/allow_execute requires defaults.readonly_only=false（需同时关闭 defaults.readonly_only）")
		}
	}
	return nil
}

func validateCommand(command, path string) error {
	command = strings.TrimSpace(command)
	if command == "" {
		return ve(path, "is required")
	}
	if strings.ContainsAny(command, ";|&`$<>()\n\r") {
		return ve(path, "must not contain shell metacharacters; llmwiki starts the process without a shell")
	}
	if strings.ContainsAny(command, `/\`) && !filepath.IsAbs(command) {
		return ve(path, "must be an executable name or an absolute path")
	}
	return nil
}

func validateTimeout(value, min, max int, path string) error {
	if value != 0 && (value < min || value > max) {
		return ve(path, fmt.Sprintf("must be between %d and %d", min, max))
	}
	return nil
}

func validateArgsNoCredentials(id string, args []string) error {
	credentialParams := map[string]bool{
		"--token": true, "--api-key": true, "--api_key": true,
		"--password": true, "--secret": true, "--authorization": true, "--header": true,
	}
	previousCredentialParam := false
	previousCredentialIndex := -1
	for i, arg := range args {
		path := fmt.Sprintf("agents.%s.args[%d]", id, i)
		lower := strings.ToLower(arg)
		if previousCredentialParam {
			return ve(path, "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境")
		}
		for param := range credentialParams {
			if lower == param || strings.HasPrefix(lower, param+"=") {
				if lower == param {
					previousCredentialParam = true
					previousCredentialIndex = i
					break
				}
				return ve(path, "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境")
			}
		}
		if hasCredentialValueShape(arg) {
			return ve(path, "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境")
		}
	}
	if previousCredentialParam {
		path := fmt.Sprintf("agents.%s.args[%d]", id, previousCredentialIndex)
		return ve(path, "命令参数不得携带凭据，请用 env_passthrough 声明变量名，并把值放进 llmwiki 进程环境")
	}
	return nil
}

func hasCredentialValueShape(value string) bool {
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "bearer ") || strings.HasPrefix(lower, "authorization:") {
		return true
	}
	for _, prefix := range []string{"sk-", "ghp_", "github_pat_", "xoxb-", "xoxp-", "AKIA"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return strings.HasPrefix(value, "eyJ") && strings.Count(value, ".") >= 2
}

// ApplyDefaultsAfterParse fills omitted values after validation.
func ApplyDefaultsAfterParse(cfg *Config) {
	if cfg == nil {
		return
	}
	if cfg.Agents == nil {
		cfg.Agents = map[string]AgentConfig{}
	}
	if cfg.Defaults.OnUnavailable == "" {
		cfg.Defaults.OnUnavailable = DefaultOnUnavailable
	}
	for id, agent := range cfg.Agents {
		if agent.CWDPolicy == "" {
			agent.CWDPolicy = DefaultCWDPolicy
		}
		if agent.InitTimeoutMS == 0 {
			agent.InitTimeoutMS = DefaultInitTimeoutMS
		}
		if agent.PromptTimeoutMS == 0 {
			agent.PromptTimeoutMS = DefaultPromptTimeoutMS
		}
		if agent.IdleTimeoutMS == 0 {
			agent.IdleTimeoutMS = DefaultIdleTimeoutMS
		}
		if agent.EnvPassthrough == nil {
			agent.EnvPassthrough = []string{"PATH", "HOME", "LANG"}
		}
		if agent.Permission.Mode == "" {
			agent.Permission.Mode = "auto"
		}
		cfg.Agents[id] = agent
	}
}

func CanonicalJSON(cfg *Config) (string, error) {
	if cfg == nil {
		cfg = DefaultConfig()
	}
	ApplyDefaultsAfterParse(cfg)
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (c *Config) Agent(id string) (AgentConfig, bool) {
	if c == nil {
		return AgentConfig{}, false
	}
	agent, ok := c.Agents[id]
	return agent, ok
}

func (c *Config) HasEnabledAgent() bool {
	if c == nil {
		return false
	}
	for _, agent := range c.Agents {
		if agent.Enabled {
			return true
		}
	}
	return false
}

type EnvVarStatus struct {
	Name    string `json:"name"`
	Present bool   `json:"present"`
}

type RedactedAgent struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Enabled         bool             `json:"enabled"`
	Command         string           `json:"command"`
	Args            []string         `json:"args"`
	EnvPassthrough  []EnvVarStatus   `json:"env_passthrough"`
	CWDPolicy       string           `json:"cwd_policy"`
	InitTimeoutMS   int              `json:"init_timeout_ms"`
	PromptTimeoutMS int              `json:"prompt_timeout_ms"`
	IdleTimeoutMS   int              `json:"idle_timeout_ms"`
	Permission      PermissionPolicy `json:"permission"`
}

func RedactedAgents(cfg *Config) []RedactedAgent {
	if cfg == nil {
		return []RedactedAgent{}
	}
	out := make([]RedactedAgent, 0, len(cfg.Agents))
	for _, agent := range cfg.Agents {
		env := make([]EnvVarStatus, 0, len(agent.EnvPassthrough))
		for _, name := range agent.EnvPassthrough {
			_, present := os.LookupEnv(name)
			env = append(env, EnvVarStatus{Name: name, Present: present})
		}
		out = append(out, RedactedAgent{
			ID: agent.ID, Name: agent.Name, Enabled: agent.Enabled, Command: agent.Command,
			Args: append([]string(nil), agent.Args...), EnvPassthrough: env,
			CWDPolicy: agent.CWDPolicy, InitTimeoutMS: agent.InitTimeoutMS,
			PromptTimeoutMS: agent.PromptTimeoutMS, IdleTimeoutMS: agent.IdleTimeoutMS,
			Permission: agent.Permission,
		})
	}
	return out
}
