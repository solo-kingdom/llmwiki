package ingest

import (
	"testing"
)

func TestParsePlanActionsMove(t *testing.T) {
	planJSON := `{"summary":"test","changes":[{"action":"move","from_path":"wiki/concepts/A_Player文化.md","to_path":"wiki/concepts/A Player文化.md","path":"wiki/concepts/A Player文化.md","rationale":"normalize"}]}`
	actions := ParsePlanActions(planJSON)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(actions))
	}
	if actions[0].Action != "move" {
		t.Errorf("expected action move, got %s", actions[0].Action)
	}
	if actions[0].FromPath != "wiki/concepts/A_Player文化.md" {
		t.Errorf("expected from_path, got %s", actions[0].FromPath)
	}
}

func TestParsePlanActionsMerge(t *testing.T) {
	planJSON := `{"summary":"test","changes":[{"action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/concepts/C.md","path":"wiki/concepts/C.md","rationale":"deduplicate"}]}`
	actions := ParsePlanActions(planJSON)
	if len(actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(actions))
	}
	if actions[0].Action != "merge" {
		t.Errorf("expected action merge, got %s", actions[0].Action)
	}
	if len(actions[0].SourcePaths) != 2 {
		t.Errorf("expected 2 source paths, got %d", len(actions[0].SourcePaths))
	}
}

func TestParsePlanActionsUpdateSkipped(t *testing.T) {
	planJSON := `{"summary":"test","changes":[{"action":"update","path":"wiki/concepts/X.md","rationale":"update content"}]}`
	actions := ParsePlanActions(planJSON)
	if len(actions) != 0 {
		t.Fatalf("expected 0 actions (update should be skipped), got %d", len(actions))
	}
}

func TestParsePlanActionsMissingFields(t *testing.T) {
	planJSON := `{"summary":"test","changes":[{"action":"move","path":"wiki/concepts/X.md","rationale":"no from_path"}]}`
	actions := ParsePlanActions(planJSON)
	if len(actions) != 0 {
		t.Fatalf("expected 0 actions (move without from_path), got %d", len(actions))
	}
}

func TestPlanStructuralCounts(t *testing.T) {
	planJSON := `{"summary":"dedupe concepts","changes":[
		{"action":"move","from_path":"wiki/concepts/A.md","to_path":"wiki/concepts/B.md","path":"wiki/concepts/B.md"},
		{"action":"merge","source_paths":["wiki/concepts/C.md","wiki/concepts/D.md"],"to_path":"wiki/concepts/CD.md","path":"wiki/concepts/CD.md"},
		{"action":"update","path":"wiki/concepts/E.md"}
	]}`
	move, merge, summary := PlanStructuralCounts(planJSON)
	if move != 1 || merge != 1 {
		t.Fatalf("move=%d merge=%d", move, merge)
	}
	if summary != "dedupe concepts" {
		t.Fatalf("summary = %q", summary)
	}
}

func TestParsePlanActionsInvalidJSON(t *testing.T) {
	actions := ParsePlanActions("not json")
	if len(actions) != 0 {
		t.Fatalf("expected 0 actions for invalid JSON, got %d", len(actions))
	}
}

func TestSourcePathsToDeleteMove(t *testing.T) {
	actions := []PlanAction{
		{Action: "move", FromPath: "wiki/concepts/Old.md", ToPath: "wiki/concepts/New.md", Path: "wiki/concepts/New.md"},
	}
	writeTargets := map[string]string{"wiki/concepts/New.md": "content"}
	toDelete := SourcePathsToDelete(actions, writeTargets)
	if len(toDelete) != 1 || toDelete[0] != "wiki/concepts/Old.md" {
		t.Fatalf("expected [wiki/concepts/Old.md], got %v", toDelete)
	}
}

func TestSourcePathsToDeleteSkipsWriteTargets(t *testing.T) {
	actions := []PlanAction{
		{Action: "move", FromPath: "wiki/concepts/New.md", ToPath: "wiki/concepts/Final.md", Path: "wiki/concepts/Final.md"},
	}
	writeTargets := map[string]string{"wiki/concepts/New.md": "content"}
	toDelete := SourcePathsToDelete(actions, writeTargets)
	if len(toDelete) != 0 {
		t.Fatalf("expected empty (write target overlap), got %v", toDelete)
	}
}

func TestSourcePathsToDeleteMerge(t *testing.T) {
	actions := []PlanAction{
		{Action: "merge", SourcePaths: []string{"wiki/concepts/A.md", "wiki/concepts/B.md"}, ToPath: "wiki/concepts/C.md", Path: "wiki/concepts/C.md"},
	}
	writeTargets := map[string]string{"wiki/concepts/C.md": "content"}
	toDelete := SourcePathsToDelete(actions, writeTargets)
	if len(toDelete) != 2 {
		t.Fatalf("expected 2 deletions, got %d: %v", len(toDelete), toDelete)
	}
}

func TestSourcePathsToDeleteInvalidPath(t *testing.T) {
	actions := []PlanAction{
		{Action: "move", FromPath: "invalid/path.md", ToPath: "wiki/concepts/New.md", Path: "wiki/concepts/New.md"},
	}
	writeTargets := map[string]string{"wiki/concepts/New.md": "content"}
	toDelete := SourcePathsToDelete(actions, writeTargets)
	if len(toDelete) != 0 {
		t.Fatalf("expected 0 (invalid path skipped), got %v", toDelete)
	}
}
