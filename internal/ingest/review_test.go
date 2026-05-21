package ingest

import (
	"testing"
)

func TestParsePlanResult(t *testing.T) {
	raw := `# Wiki Plan

Will update one page.

` + "```json\n{\"summary\":\"ok\",\"changes\":[]}\n```"
	result, err := ParsePlanResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	if result.PlanMarkdown == "" {
		t.Fatal("expected markdown")
	}
	if result.PlanJSON == "" {
		t.Fatal("expected json")
	}
}

func TestParseReviewIDFromRef(t *testing.T) {
	id, ok := ParseReviewIDFromRef("review:abc")
	if !ok || id != "abc" {
		t.Fatalf("got %q %v", id, ok)
	}
	_, ok = ParseReviewIDFromRef("session:x")
	if ok {
		t.Fatal("expected false")
	}
}
