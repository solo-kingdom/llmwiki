package mcp

import (
	"context"
	"fmt"
	"time"
)

const checkTimeout = 10 * time.Second

// ServerCheckResult is the status of a single MCP server probe.
type ServerCheckResult struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	ToolCount int    `json:"tool_count,omitempty"`
}

// CheckServers probes each configured server and returns per-server status.
func CheckServers(ctx context.Context, cfg *Config) []ServerCheckResult {
	if cfg == nil || len(cfg.Servers) == 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, checkTimeout*time.Duration(len(cfg.Servers)))
	defer cancel()

	out := make([]ServerCheckResult, 0, len(cfg.Servers))
	for _, srv := range cfg.Servers {
		out = append(out, checkServer(ctx, cfg, srv))
	}
	return out
}

func checkServer(ctx context.Context, cfg *Config, srv ServerConfig) ServerCheckResult {
	res := ServerCheckResult{
		ID:      srv.ID,
		Name:    srv.Name,
		Enabled: srv.Enabled,
	}
	if !srv.Enabled {
		res.Status = "disabled"
		res.Message = "已禁用"
		return res
	}
	if srv.Transport == "stdio" {
		res.Status = "error"
		res.Message = "stdio transport 暂不支持连接检查"
		return res
	}

	probeCtx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()

	tr, err := NewTransport(srv)
	if err != nil {
		res.Status = "error"
		res.Message = err.Error()
		return res
	}
	defer tr.Close()

	tools, err := tr.ListTools(probeCtx)
	if err != nil {
		res.Status = "error"
		res.Message = err.Error()
		return res
	}
	filtered := FilterTools(tools, cfg, &srv)
	res.Status = "ok"
	res.ToolCount = len(filtered)
	if res.ToolCount == 0 {
		res.Message = "连接正常，但无可用工具"
	} else {
		res.Message = fmt.Sprintf("连接正常，%d 个可用工具", res.ToolCount)
	}
	return res
}
