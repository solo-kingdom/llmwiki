package mcp

import (
	"testing"
)

type stubConfigReader map[string]string

func (m stubConfigReader) GetConfig(key string) (string, error) {
	return m[key], nil
}

func TestParseToolLoopMaxRounds(t *testing.T) {
	n, err := ParseToolLoopMaxRounds("12")
	if err != nil || n != 12 {
		t.Fatalf("ParseToolLoopMaxRounds(12) = (%d, %v)", n, err)
	}
	if _, err := ParseToolLoopMaxRounds("0"); err == nil {
		t.Fatal("expected error for 0")
	}
	if _, err := ParseToolLoopMaxRounds("99"); err == nil {
		t.Fatal("expected error for 99")
	}
}

func TestToolLoopConfigForModeFromStore(t *testing.T) {
	store := stubConfigReader{
		ConfigSessionToolLoopMaxRoundsOrganize: "10",
		ConfigSessionToolLoopMaxCallsPerRound:  "6",
	}
	cfg := ToolLoopConfigForModeFromStore("organize", store)
	if cfg.MaxRounds != 10 {
		t.Fatalf("MaxRounds = %d, want 10", cfg.MaxRounds)
	}
	if cfg.MaxToolCallsPerRound != 6 {
		t.Fatalf("MaxToolCallsPerRound = %d, want 6", cfg.MaxToolCallsPerRound)
	}

	defaultCfg := ToolLoopConfigForModeFromStore("organize", stubConfigReader{})
	if defaultCfg.MaxRounds != ToolLoopConfigForMode("organize").MaxRounds {
		t.Fatalf("expected default MaxRounds %d, got %d", ToolLoopConfigForMode("organize").MaxRounds, defaultCfg.MaxRounds)
	}
}
