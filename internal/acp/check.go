package acp

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"sort"
	"time"
)

type AgentCheckResult struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Enabled         bool   `json:"enabled"`
	Status          string `json:"status"`
	Code            string `json:"code,omitempty"`
	Message         string `json:"message,omitempty"`
	AgentName       string `json:"agent_name,omitempty"`
	AgentVersion    string `json:"agent_version,omitempty"`
	ProtocolVersion int    `json:"protocol_version,omitempty"`
}

type AvailabilityResult struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

func CheckAgents(ctx context.Context, cfg *Config, workspace string) []AgentCheckResult {
	if cfg == nil || len(cfg.Agents) == 0 {
		return []AgentCheckResult{}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ids := sortedAgentIDs(cfg.Agents)
	out := make([]AgentCheckResult, 0, len(ids))
	for _, id := range ids {
		agent := cfg.Agents[id]
		out = append(out, checkAgent(ctx, agent, workspace))
	}
	return out
}

func checkAgent(ctx context.Context, agent AgentConfig, workspace string) AgentCheckResult {
	result := AgentCheckResult{ID: agent.ID, Name: agent.Name, Enabled: agent.Enabled}
	if !agent.Enabled {
		result.Status = "disabled"
		result.Message = "已禁用"
		return result
	}
	if _, err := exec.LookPath(agent.Command); err != nil {
		result.Status = "error"
		result.Code = "cli_not_found"
		result.Message = fmt.Sprintf("命令 %s 未找到（PATH 中不可用）", agent.Command)
		return result
	}
	applyAgentDefaults(&agent)
	timeout := time.Duration(agent.InitTimeoutMS) * time.Millisecond
	if timeout > 15*time.Second {
		timeout = 15 * time.Second
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cwd, err := ResolveCWD(workspace, "probe", agent.CWDPolicy)
	if err != nil {
		result.Status = "error"
		result.Code = "cwd_invalid"
		result.Message = err.Error()
		return result
	}
	proc, err := spawn(probeCtx, agent, cwd)
	if err != nil {
		result.Status = "error"
		result.Code = "spawn_failed"
		result.Message = err.Error()
		return result
	}
	defer func() { _ = proc.Terminate() }()
	client := newClient(proc, agent)
	init, err := client.Initialize(probeCtx)
	if err != nil {
		result.Status = "error"
		if errors.Is(err, ErrProtocolVersionUnsupported) {
			result.Code = "protocol_version_unsupported"
		} else {
			result.Code = "initialize_failed"
		}
		result.Message = err.Error()
		return result
	}
	result.Status = "ok"
	result.Code = "ok"
	result.Message = "连接正常"
	result.AgentName = init.AgentInfo.Name
	result.AgentVersion = init.AgentInfo.Version
	result.ProtocolVersion = init.ProtocolVersion
	return result
}

func Availability(cfg *Config) map[string]AvailabilityResult {
	out := map[string]AvailabilityResult{}
	if cfg == nil {
		return out
	}
	for _, agent := range cfg.Agents {
		if _, err := exec.LookPath(agent.Command); err != nil {
			out[agent.ID] = AvailabilityResult{Available: false, Reason: fmt.Sprintf("命令 %s 未找到（PATH 中不可用）", agent.Command)}
			continue
		}
		out[agent.ID] = AvailabilityResult{Available: true}
	}
	return out
}

func sortedAgentIDs(agents map[string]AgentConfig) []string {
	ids := make([]string, 0, len(agents))
	for id := range agents {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
