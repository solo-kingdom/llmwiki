package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeWikiFile(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func setupMiniWiki(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	writeWikiFile(t, root, "wiki/index.md", `---
title: 内容目录
type: index
date: "2024-01-01"
---
# Index
`)
	writeWikiFile(t, root, "wiki/overview.md", `---
title: 总览
date: "2024-01-01"
---
`)
	writeWikiFile(t, root, "wiki/log.md", `---
title: 操作日志
---
# Log

## [2024-01-01] init | 初始化
`)
	writeWikiFile(t, root, "wiki/entities/hub.md", `---
title: Hub
type: entity
date: "2024-01-02"
---
See [[entities/orphan]] and [[concepts/missing]].
`)
	writeWikiFile(t, root, "wiki/entities/orphan.md", `---
title: Orphan
type: entity
date: "2024-01-02"
---
No inbound links.
`)
	writeWikiFile(t, root, "wiki/entities/bad-type.md", `---
title: Bad Type
type: concept
date: "2024-01-02"
---
Wrong type for entities/.
`)
	writeWikiFile(t, root, "wiki/concepts/linked.md", `---
title: Linked
type: concept
date: "2024-01-03"
---
Linked from hub via [[entities/hub]].
`)

	rawSources := filepath.Join(root, "raw", "sources")
	if err := os.MkdirAll(rawSources, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rawSources, "paper.pdf"), []byte("pdf"), 0o644); err != nil {
		t.Fatal(err)
	}

	return root
}

func TestLintWorkspace(t *testing.T) {
	root := setupMiniWiki(t)
	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}

	codes := make(map[string]int)
	for _, issue := range report.Issues {
		codes[issue.Code]++
	}

	if codes[LintCodeDeadLink] == 0 {
		t.Errorf("expected dead_link issues, got codes %v", codes)
	}
	if codes[LintCodeOrphanPage] == 0 {
		t.Errorf("expected orphan_page, got codes %v", codes)
	}
	if codes[LintCodeTypeDirMismatch] == 0 {
		t.Errorf("expected type_dir_mismatch, got codes %v", codes)
	}
	if report.Stats.PageCount < 5 {
		t.Errorf("expected at least 5 pages, got %d", report.Stats.PageCount)
	}
	if report.Stats.SourceCount != 1 {
		t.Errorf("expected 1 source file, got %d", report.Stats.SourceCount)
	}
	if report.Stats.LastUpdated != "2024-01-03" {
		t.Errorf("expected last_updated 2024-01-03, got %q", report.Stats.LastUpdated)
	}
}

func TestValidateFrontmatter(t *testing.T) {
	issues := ValidateFrontmatter("wiki/entities/x.md", Frontmatter{Title: "T", Date: "2024-01-01", Type: "entity"}, "entities")
	if len(issues) != 0 {
		t.Fatalf("expected no issues: %v", issues)
	}

	issues = ValidateFrontmatter("wiki/entities/x.md", Frontmatter{Type: "concept"}, "entities")
	if len(issues) < 2 {
		t.Fatalf("expected missing + mismatch issues: %v", issues)
	}
}

func TestLintMisplacedTopLevelPage(t *testing.T) {
	root := t.TempDir()
	writeWikiFile(t, root, "wiki/dsp.md", `---
title: DSP
type: entity
date: "2024-01-01"
---
# DSP`)

	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, issue := range report.Issues {
		if issue.Code == LintCodeMisplacedWikiPage && issue.Path == "wiki/dsp.md" {
			found = true
			if !strings.Contains(issue.Message, "wiki/entities/") {
				t.Fatalf("expected suggested dir in message: %q", issue.Message)
			}
		}
	}
	if !found {
		t.Fatalf("expected misplaced_wiki_page issue, got %#v", report.Issues)
	}

	data, err := os.ReadFile(filepath.Join(root, "wiki", "dsp.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "# DSP") {
		t.Fatal("misplaced page should not be modified by lint")
	}
}

func TestLintExcludesTemplatesFromOrphanChecks(t *testing.T) {
	root := t.TempDir()
	writeWikiFile(t, root, "wiki/templates/entity.md", `---
title: Template
type: entity
date: "2024-01-01"
---
# Template`)

	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range report.Issues {
		if issue.Path == "wiki/templates/entity.md" && issue.Code == LintCodeOrphanPage {
			t.Fatalf("template should not be orphan-checked: %#v", issue)
		}
	}
}

func TestLintReportHasErrors(t *testing.T) {
	r := &LintReport{Issues: []LintIssue{{Severity: LintSeverityWarning}}}
	if r.HasErrors() {
		t.Fatal("warnings should not count as errors")
	}
	r.Issues = append(r.Issues, LintIssue{Severity: LintSeverityError})
	if !r.HasErrors() {
		t.Fatal("expected HasErrors true")
	}
}
