package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLintDuplicatePages(t *testing.T) {
	root := t.TempDir()
	wikiDir := filepath.Join(root, "wiki", "concepts")
	if err := os.MkdirAll(wikiDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(wikiDir, "A_Player文化.md"), []byte("# A Player 文化\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wikiDir, "A Player文化.md"), []byte("# A Player 文化\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wikiDir, "组织裁剪方法论.md"), []byte("# 组织裁剪\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}

	var dupIssues []LintIssue
	for _, issue := range report.Issues {
		if issue.Code == LintCodeDuplicatePage {
			dupIssues = append(dupIssues, issue)
		}
	}
	if len(dupIssues) < 2 {
		t.Fatalf("expected at least 2 duplicate_page issues, got %d", len(dupIssues))
	}
}

func TestLintDuplicatePagesDifferentDirsNoReport(t *testing.T) {
	root := t.TempDir()
	entityDir := filepath.Join(root, "wiki", "entities")
	conceptDir := filepath.Join(root, "wiki", "concepts")
	if err := os.MkdirAll(entityDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(conceptDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(entityDir, "Test.md"), []byte("# Test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(conceptDir, "Test.md"), []byte("# Test\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}

	for _, issue := range report.Issues {
		if issue.Code == LintCodeDuplicatePage {
			t.Errorf("expected no duplicate_page across different dirs, got: %s", issue.Message)
		}
	}
}
