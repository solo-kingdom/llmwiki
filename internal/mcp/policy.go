package mcp

import (
	"strings"
)

// FilterTools returns tools the caller may expose/invoke under policy.
func FilterTools(tools []Tool, cfg *Config, server *ServerConfig) []Tool {
	if cfg == nil || server == nil {
		return nil
	}
	readonlyOnly := cfg.Defaults.ReadonlyOnly
	if !readonlyOnly && !server.AllowWriteTools {
		readonlyOnly = false
	}
	allowed := allowedSet(server, readonlyOnly)
	if len(allowed) == 0 {
		return nil
	}
	out := make([]Tool, 0, len(tools))
	for _, t := range tools {
		if allowed[strings.ToLower(t.Name)] {
			out = append(out, t)
		}
	}
	return out
}

func allowedSet(server *ServerConfig, readonlyOnly bool) map[string]bool {
	tools := server.AllowedTools
	if len(tools) == 0 {
		if readonlyOnly {
			tools = []string{DefaultToolSearch, DefaultToolRead}
		}
	}
	set := make(map[string]bool, len(tools))
	for _, t := range tools {
		name := strings.ToLower(strings.TrimSpace(t))
		if name == "" {
			continue
		}
		if readonlyOnly && isWriteToolName(name) && !server.AllowWriteTools {
			continue
		}
		set[name] = true
	}
	return set
}

// IsToolCallAllowed checks whether a tool may be invoked.
func IsToolCallAllowed(cfg *Config, server *ServerConfig, toolName string) bool {
	if cfg == nil || server == nil {
		return false
	}
	name := strings.ToLower(strings.TrimSpace(toolName))
	allowed := allowedSet(server, cfg.Defaults.ReadonlyOnly)
	return allowed[name]
}
