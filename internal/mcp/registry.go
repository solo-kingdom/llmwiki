package mcp

import (
	"sync"
)

// Registry holds parsed MCP configuration and provides scoped server lists.
type Registry struct {
	mu   sync.RWMutex
	cfg  *Config
	raw  string
}

// NewRegistry loads config from stored JSON.
func NewRegistry(raw string) (*Registry, error) {
	cfg, err := ParseConfig(raw)
	if err != nil {
		return nil, err
	}
	return &Registry{cfg: cfg, raw: raw}, nil
}

// Config returns the current configuration snapshot.
func (r *Registry) Config() *Config {
	if r == nil {
		return DefaultConfig()
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cfg
}

// JobServers returns enabled servers scoped to job execution.
func (r *Registry) JobServers() []ServerConfig {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []ServerConfig
	for _, s := range r.cfg.Servers {
		if !s.Enabled {
			continue
		}
		// Job scope when job=true, or scope omitted (both false). Skip chat-only servers.
		if s.Scope.Chat && !s.Scope.Job {
			continue
		}
		out = append(out, s)
	}
	return out
}

// ChatServers returns enabled servers scoped to session chat.
func (r *Registry) ChatServers() []ServerConfig {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []ServerConfig
	for _, s := range r.cfg.Servers {
		if !s.Enabled || !s.Scope.Chat {
			continue
		}
		out = append(out, s)
	}
	return out
}

// Reload replaces configuration from raw JSON.
func (r *Registry) Reload(raw string) error {
	cfg, err := ParseConfig(raw)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cfg = cfg
	r.raw = raw
	return nil
}
