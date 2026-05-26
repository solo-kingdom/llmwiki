package mcp

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

const (
	ConfigSessionToolLoopMaxRoundsIngest   = "session_tool_loop_max_rounds_ingest"
	ConfigSessionToolLoopMaxRoundsQA       = "session_tool_loop_max_rounds_qa"
	ConfigSessionToolLoopMaxRoundsOrganize = "session_tool_loop_max_rounds_organize"
	ConfigSessionToolLoopMaxCallsPerRound  = "session_tool_loop_max_calls_per_round"

	MinToolLoopMaxRounds        = 1
	MaxToolLoopMaxRounds        = 32
	MinToolLoopMaxCallsPerRound = 1
	MaxToolLoopMaxCallsPerRound = 16
)

// ConfigReader reads persisted app_config values.
type ConfigReader interface {
	GetConfig(key string) (string, error)
}

func sessionToolLoopMaxRoundsConfigKey(mode string) string {
	switch mode {
	case "qa":
		return ConfigSessionToolLoopMaxRoundsQA
	case "organize":
		return ConfigSessionToolLoopMaxRoundsOrganize
	default:
		return ConfigSessionToolLoopMaxRoundsIngest
	}
}

// ParseToolLoopMaxRounds validates configured session tool loop round limits.
func ParseToolLoopMaxRounds(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("session tool loop max rounds must not be empty")
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("invalid session tool loop max rounds: %q", s)
	}
	if n < MinToolLoopMaxRounds || n > MaxToolLoopMaxRounds {
		return 0, fmt.Errorf("session tool loop max rounds must be between %d and %d", MinToolLoopMaxRounds, MaxToolLoopMaxRounds)
	}
	return n, nil
}

// ParseToolLoopMaxCallsPerRound validates configured per-round tool call limits.
func ParseToolLoopMaxCallsPerRound(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("session tool loop max calls per round must not be empty")
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("invalid session tool loop max calls per round: %q", s)
	}
	if n < MinToolLoopMaxCallsPerRound || n > MaxToolLoopMaxCallsPerRound {
		return 0, fmt.Errorf("session tool loop max calls per round must be between %d and %d", MinToolLoopMaxCallsPerRound, MaxToolLoopMaxCallsPerRound)
	}
	return n, nil
}

// SessionToolLoopMaxRoundsForResponse returns stored value or mode default.
func SessionToolLoopMaxRoundsForResponse(stored, mode string) string {
	if strings.TrimSpace(stored) != "" {
		return stored
	}
	return strconv.Itoa(ToolLoopConfigForMode(mode).MaxRounds)
}

// SessionToolLoopMaxCallsForResponse returns stored value or default.
func SessionToolLoopMaxCallsForResponse(stored string) string {
	if strings.TrimSpace(stored) != "" {
		return stored
	}
	return strconv.Itoa(ToolLoopConfigForMode("").MaxToolCallsPerRound)
}

// ToolLoopConfigForModeFromStore resolves tool loop limits using settings overrides.
func ToolLoopConfigForModeFromStore(mode string, store ConfigReader) llm.ToolLoopConfig {
	cfg := ToolLoopConfigForMode(mode)
	if store == nil {
		return cfg
	}
	if raw, err := store.GetConfig(sessionToolLoopMaxRoundsConfigKey(mode)); err == nil && strings.TrimSpace(raw) != "" {
		if n, err := ParseToolLoopMaxRounds(raw); err == nil {
			cfg.MaxRounds = n
		}
	}
	if raw, err := store.GetConfig(ConfigSessionToolLoopMaxCallsPerRound); err == nil && strings.TrimSpace(raw) != "" {
		if n, err := ParseToolLoopMaxCallsPerRound(raw); err == nil {
			cfg.MaxToolCallsPerRound = n
		}
	}
	return cfg
}
