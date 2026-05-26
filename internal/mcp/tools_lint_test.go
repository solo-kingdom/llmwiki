package mcp

import (
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

func TestFormatLintMCP(t *testing.T) {
	report := &engine.LintReport{
		Issues: []engine.LintIssue{
			{Severity: engine.LintSeverityError, Code: engine.LintCodeDeadLink, Path: "wiki/a.md", Message: "死链"},
			{Severity: engine.LintSeverityWarning, Code: engine.LintCodeOrphanPage, Path: "wiki/b.md", Message: "孤立"},
		},
		Stats: engine.LintStats{PageCount: 2, SourceCount: 0},
	}
	out := formatLintMCP(report)
	if !strings.Contains(out, "## error") {
		t.Fatalf("expected error section: %s", out)
	}
	if !strings.Contains(out, "dead_link") {
		t.Fatalf("expected dead_link in output: %s", out)
	}
	if !strings.Contains(out, "## warning") {
		t.Fatalf("expected warning section: %s", out)
	}
}
