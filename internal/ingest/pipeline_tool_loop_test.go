package ingest

import (
	"fmt"
	"testing"
)

func TestDefaultToolLoopConfigForStep(t *testing.T) {
	tests := []struct {
		step         PromptStep
		wantRounds   int
		wantPerRound int
	}{
		{StepAnalysis, 4, 4},
		{StepPlan, 5, 4},
		{StepPlanOrganize, 8, 4},
		{StepPlanQA, 5, 4},
		{StepGeneration, 4, 4},
		{StepMergeBody, 0, 0},
	}
	for _, tt := range tests {
		t.Run(string(tt.step), func(t *testing.T) {
			cfg := defaultToolLoopConfigForStep(tt.step)
			if cfg.MaxRounds != tt.wantRounds {
				t.Errorf("MaxRounds = %d, want %d", cfg.MaxRounds, tt.wantRounds)
			}
			if cfg.MaxToolCallsPerRound != tt.wantPerRound {
				t.Errorf("MaxToolCallsPerRound = %d, want %d", cfg.MaxToolCallsPerRound, tt.wantPerRound)
			}
		})
	}
}

func TestRecordToolLoopFallback(t *testing.T) {
	rec := &stubRecorder{}
	err := fmt.Errorf("tool loop exceeded max rounds (%d)", 8)
	recordToolLoopFallback(rec, "plan", defaultToolLoopConfigForStep(StepPlanOrganize), err)

	if len(rec.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(rec.events))
	}
	ev := rec.events[0]
	if ev.step != "plan" || ev.phase != "warn" {
		t.Fatalf("unexpected event: %+v", ev)
	}
	if ev.message != "tool loop failed, falling back to stream" {
		t.Errorf("message = %q", ev.message)
	}
	if ev.payload["error"] != err.Error() {
		t.Errorf("payload error = %v", ev.payload["error"])
	}
	if ev.payload["max_rounds"] != 8 {
		t.Errorf("payload max_rounds = %v, want 8", ev.payload["max_rounds"])
	}
}

func TestRecordToolLoopFallbackNilSafe(t *testing.T) {
	recordToolLoopFallback(nil, "plan", defaultToolLoopConfigForStep(StepPlan), fmt.Errorf("boom"))
}
