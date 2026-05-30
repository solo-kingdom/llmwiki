package engine

import (
	"strings"
	"testing"
)

func setupEntityConceptWiki(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	writeWikiFile(t, root, "wiki/entities/AppLovin.md", `---
title: AppLovin
type: entity
date: "2026-05-27"
---
# AppLovin

See [[concepts/AppLovin组织裁剪方法论]].
`)
	writeWikiFile(t, root, "wiki/concepts/AppLovin组织裁剪方法论.md", `---
title: AppLovin组织裁剪方法论
type: concept
date: "2026-05-27"
---
# AppLovin 组织裁剪方法论

[[AppLovin]] 的裁剪方法。
`)
	writeWikiFile(t, root, "wiki/concepts/组织裁剪方法论.md", `---
title: 组织裁剪方法论
type: concept
date: "2026-05-27"
---
# 组织裁剪方法论

案例：[[AppLovin]]
`)
	writeWikiFile(t, root, "wiki/index.md", `---
title: Index
type: index
date: "2026-05-27"
---
# Index
`)

	return root
}

func TestLintEntityConceptCouplingDetected(t *testing.T) {
	root := setupEntityConceptWiki(t)
	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, issue := range report.Issues {
		if issue.Code == LintCodeEntityConceptCoupling && issue.Path == "wiki/concepts/AppLovin组织裁剪方法论.md" {
			found = true
			if issue.Severity != LintSeverityWarning {
				t.Fatalf("expected warning severity, got %q", issue.Severity)
			}
			if !strings.Contains(issue.Message, "AppLovin") {
				t.Fatalf("expected entity name in message: %q", issue.Message)
			}
		}
	}
	if !found {
		t.Fatalf("expected entity_concept_coupling issue, got %#v", report.Issues)
	}
}

func TestLintEntityConceptCouplingNeutralConceptAccepted(t *testing.T) {
	root := setupEntityConceptWiki(t)
	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}

	for _, issue := range report.Issues {
		if issue.Code == LintCodeEntityConceptCoupling && issue.Path == "wiki/concepts/组织裁剪方法论.md" {
			t.Fatalf("neutral concept should not trigger coupling: %#v", issue)
		}
	}
}

func TestLintEntityConceptCouplingFilenameVariants(t *testing.T) {
	root := t.TempDir()
	writeWikiFile(t, root, "wiki/entities/applovin.md", `---
title: AppLovin
type: entity
date: "2026-05-27"
---
# AppLovin
`)
	writeWikiFile(t, root, "wiki/concepts/applovin_org_cut_methodology.md", `---
title: AppLovin Org Cut Methodology
type: concept
date: "2026-05-27"
---
# AppLovin Org Cut Methodology
`)
	writeWikiFile(t, root, "wiki/index.md", `---
title: Index
type: index
date: "2026-05-27"
---
`)

	report, err := LintWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, issue := range report.Issues {
		if issue.Code == LintCodeEntityConceptCoupling {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected coupling warning for english methodology title, got %#v", report.Issues)
	}
}

func TestNormalizeNameKey(t *testing.T) {
	tests := map[string]string{
		"App Lovin":  "applovin",
		"App-Lovin":  "applovin",
		"App_Lovin":  "applovin",
		"APPLOVIN":   "applovin",
		"组织 裁剪":      "组织裁剪",
	}
	for input, want := range tests {
		if got := normalizeNameKey(input); got != want {
			t.Fatalf("normalizeNameKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestHasAbstractConceptKeyword(t *testing.T) {
	if !hasAbstractConceptKeyword(normalizeNameKey("组织裁剪方法论")) {
		t.Fatal("expected methodology keyword match")
	}
	if hasAbstractConceptKeyword(normalizeNameKey("广告平台")) {
		t.Fatal("did not expect abstract keyword match")
	}
}
