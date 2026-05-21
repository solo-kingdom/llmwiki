package mcp

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	ConfigVersion         = 1
	DefaultReadonlyOnly   = true
	DefaultFallbackMode   = "local_only"
	DefaultToolSearch     = "search"
	DefaultToolRead       = "read"
	MinTimeoutMS          = 1000
	MaxTimeoutMS          = 300000
	DefaultTimeoutMS      = 15000
	MaxRetryCount         = 5
	MaxBackoffMS          = 60000
)

var (
	validTransports = map[string]bool{
		"sse":              true,
		"streamable-http":  true,
		"stdio":            true,
	}
	writeToolNames = map[string]bool{
		"create": true, "edit": true, "append": true, "delete": true,
		"write": true, "update": true, "remove": true,
	}
	readonlyToolNames = map[string]bool{
		DefaultToolSearch: true,
		DefaultToolRead:   true,
	}
)

// Config is the root MCP servers document stored in app_config.
type Config struct {
	Version  int                       `json:"version"`
	Servers  map[string]ServerConfig   `json:"servers"`
	Defaults Defaults                  `json:"defaults"`
}

type ServerConfig struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	Enabled         bool              `json:"enabled"`
	Transport       string            `json:"transport"`
	URL             string            `json:"url"`
	Headers         map[string]string `json:"headers,omitempty"`
	TimeoutMS       int               `json:"timeout_ms"`
	Retry           RetryConfig       `json:"retry"`
	Scope           ScopeConfig       `json:"scope"`
	AllowedTools    []string          `json:"allowed_tools,omitempty"`
	AllowWriteTools bool              `json:"allow_write_tools,omitempty"`
}

type RetryConfig struct {
	Max       int `json:"max"`
	BackoffMS int `json:"backoff_ms"`
}

type ScopeConfig struct {
	Job  bool `json:"job"`
	Chat bool `json:"chat"`
}

type Defaults struct {
	ReadonlyOnly bool   `json:"readonly_only"`
	FallbackMode string `json:"fallback_mode"`
}

// ValidationError carries a JSON path for API feedback.
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

// ParseConfig unmarshals and validates MCP config JSON.
func ParseConfig(raw string) (*Config, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultConfig(), nil
	}
	type defaultsRaw struct {
		ReadonlyOnly *bool  `json:"readonly_only"`
		FallbackMode string `json:"fallback_mode"`
	}
	var envelope struct {
		Version  int             `json:"version"`
		Servers  json.RawMessage `json:"servers"`
		Defaults defaultsRaw     `json:"defaults"`
	}
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
		return nil, ve("", fmt.Sprintf("invalid JSON: %v", err))
	}
	servers, err := parseServersJSON(envelope.Servers)
	if err != nil {
		return nil, err
	}
	cfg := &Config{
		Version: envelope.Version,
		Servers: servers,
		Defaults: Defaults{
			FallbackMode: envelope.Defaults.FallbackMode,
		},
	}
	if envelope.Defaults.ReadonlyOnly != nil {
		cfg.Defaults.ReadonlyOnly = *envelope.Defaults.ReadonlyOnly
	} else {
		cfg.Defaults.ReadonlyOnly = DefaultReadonlyOnly
	}
	if err := ValidateConfig(cfg); err != nil {
		return nil, err
	}
	ApplyDefaultsAfterParse(cfg, envelope.Defaults.ReadonlyOnly)
	return cfg, nil
}

// DefaultConfig returns an empty valid configuration.
func DefaultConfig() *Config {
	return &Config{
		Version: ConfigVersion,
		Servers: map[string]ServerConfig{},
		Defaults: Defaults{
			ReadonlyOnly: DefaultReadonlyOnly,
			FallbackMode: DefaultFallbackMode,
		},
	}
}

// NormalizeConfig fills defaults on a validated config.
func NormalizeConfig(cfg *Config) {
	if cfg == nil {
		return
	}
	if cfg.Servers == nil {
		cfg.Servers = map[string]ServerConfig{}
	}
	if cfg.Version == 0 {
		cfg.Version = ConfigVersion
	}
	if cfg.Defaults.FallbackMode == "" {
		cfg.Defaults.FallbackMode = DefaultFallbackMode
	}
	if !cfg.Defaults.ReadonlyOnly && cfg.Defaults.FallbackMode == "" {
		cfg.Defaults.FallbackMode = DefaultFallbackMode
	}
	// readonly_only defaults to true when omitted in JSON (zero value is false, fix after unmarshal)
}

// ApplyDefaultsAfterParse sets implicit defaults not represented by Go zero values.
func ApplyDefaultsAfterParse(cfg *Config, rawDefaultsReadonly *bool) {
	if cfg == nil {
		return
	}
	if rawDefaultsReadonly == nil {
		cfg.Defaults.ReadonlyOnly = DefaultReadonlyOnly
	}
	if cfg.Defaults.FallbackMode == "" {
		cfg.Defaults.FallbackMode = DefaultFallbackMode
	}
	for id, s := range cfg.Servers {
		if s.TimeoutMS <= 0 {
			s.TimeoutMS = DefaultTimeoutMS
		}
		if s.AllowedTools == nil || len(s.AllowedTools) == 0 {
			if cfg.Defaults.ReadonlyOnly {
				s.AllowedTools = []string{DefaultToolSearch, DefaultToolRead}
			}
		}
		cfg.Servers[id] = s
	}
}

// ValidateConfig checks structural and policy constraints.
func ValidateConfig(cfg *Config) error {
	if cfg == nil {
		return ve("", "config is nil")
	}
	if cfg.Version != ConfigVersion {
		return ve("version", fmt.Sprintf("must be %d", ConfigVersion))
	}
	if cfg.Defaults.FallbackMode != "" && cfg.Defaults.FallbackMode != "local_only" {
		return ve("defaults.fallback_mode", "must be local_only")
	}
	for key, s := range cfg.Servers {
		prefix := fmt.Sprintf("servers.%s", key)
		if strings.TrimSpace(key) == "" {
			return ve("servers", "empty server key")
		}
		if strings.TrimSpace(s.ID) == "" {
			s.ID = key
		} else if s.ID != key {
			return ve(prefix+".id", fmt.Sprintf("must match map key %q", key))
		}
		if err := validateServer(&s, prefix, cfg.Defaults.ReadonlyOnly); err != nil {
			return err
		}
	}
	return nil
}

func parseServersJSON(raw json.RawMessage) (map[string]ServerConfig, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return map[string]ServerConfig{}, nil
	}
	switch trimmed[0] {
	case '{':
		var asMap map[string]ServerConfig
		if err := json.Unmarshal(raw, &asMap); err != nil {
			return nil, ve("servers", fmt.Sprintf("invalid object: %v", err))
		}
		return normalizeServersMap(asMap)
	case '[':
		var asArr []ServerConfig
		if err := json.Unmarshal(raw, &asArr); err != nil {
			return nil, ve("servers", fmt.Sprintf("invalid array: %v", err))
		}
		return serversArrayToMap(asArr)
	default:
		return nil, ve("servers", "must be an object keyed by server id")
	}
}

func serversArrayToMap(arr []ServerConfig) (map[string]ServerConfig, error) {
	if len(arr) == 0 {
		return map[string]ServerConfig{}, nil
	}
	m := make(map[string]ServerConfig, len(arr))
	for i, s := range arr {
		id := strings.TrimSpace(s.ID)
		if id == "" {
			return nil, ve(fmt.Sprintf("servers[%d].id", i), "is required")
		}
		if _, dup := m[id]; dup {
			return nil, ve(fmt.Sprintf("servers[%d].id", i), fmt.Sprintf("duplicate id %q", id))
		}
		s.ID = id
		m[id] = s
	}
	return m, nil
}

func normalizeServersMap(m map[string]ServerConfig) (map[string]ServerConfig, error) {
	if len(m) == 0 {
		return map[string]ServerConfig{}, nil
	}
	out := make(map[string]ServerConfig, len(m))
	for key, s := range m {
		k := strings.TrimSpace(key)
		if k == "" {
			return nil, ve("servers", "empty server key")
		}
		if strings.TrimSpace(s.ID) == "" {
			s.ID = k
		} else if s.ID != k {
			return nil, ve(fmt.Sprintf("servers.%s.id", k), fmt.Sprintf("must match map key %q", k))
		}
		out[k] = s
	}
	return out, nil
}

func validateServer(s *ServerConfig, prefix string, readonlyOnly bool) error {
	if strings.TrimSpace(s.ID) == "" {
		return ve(prefix+".id", "is required")
	}
	if strings.TrimSpace(s.Name) == "" {
		return ve(prefix+".name", "is required")
	}
	tr := strings.TrimSpace(s.Transport)
	if !validTransports[tr] {
		return ve(prefix+".transport", "must be one of: sse, streamable-http, stdio")
	}
	if tr != "stdio" && strings.TrimSpace(s.URL) == "" {
		return ve(prefix+".url", "is required for "+tr)
	}
	if s.TimeoutMS != 0 && (s.TimeoutMS < MinTimeoutMS || s.TimeoutMS > MaxTimeoutMS) {
		return ve(prefix+".timeout_ms", fmt.Sprintf("must be between %d and %d", MinTimeoutMS, MaxTimeoutMS))
	}
	if s.Retry.Max < 0 || s.Retry.Max > MaxRetryCount {
		return ve(prefix+".retry.max", fmt.Sprintf("must be between 0 and %d", MaxRetryCount))
	}
	if s.Retry.BackoffMS < 0 || s.Retry.BackoffMS > MaxBackoffMS {
		return ve(prefix+".retry.backoff_ms", fmt.Sprintf("must be between 0 and %d", MaxBackoffMS))
	}
	tools := s.AllowedTools
	if len(tools) == 0 && readonlyOnly {
		tools = []string{DefaultToolSearch, DefaultToolRead}
	}
	for _, t := range tools {
		if isWriteToolName(t) && readonlyOnly && !s.AllowWriteTools {
			return ve(prefix+".allowed_tools",
				fmt.Sprintf("write tool %q requires allow_write_tools=true when defaults.readonly_only is true", t))
		}
	}
	return nil
}

func isWriteToolName(name string) bool {
	return IsWriteToolName(name)
}

// IsWriteToolName reports whether a tool name is treated as a write operation.
func IsWriteToolName(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	if writeToolNames[n] {
		return true
	}
	for w := range writeToolNames {
		if strings.Contains(n, w) {
			return true
		}
	}
	return false
}

// IsReadonlyTool reports whether a tool name is in the default readonly set.
func IsReadonlyTool(name string) bool {
	return readonlyToolNames[strings.ToLower(strings.TrimSpace(name))]
}

// CanonicalJSON returns normalized JSON for storage.
func CanonicalJSON(cfg *Config) (string, error) {
	if cfg == nil {
		cfg = DefaultConfig()
	}
	NormalizeConfig(cfg)
	ApplyDefaultsAfterParse(cfg, nil)
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}
