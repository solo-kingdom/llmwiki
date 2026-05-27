package engine

import (
	"strings"
	"testing"
)

func TestClassifyWikiPath(t *testing.T) {
	tests := []struct {
		path string
		want WikiPathKind
	}{
		{"wiki/entities/x.md", WikiPathTypedContent},
		{"wiki/dsp.md", WikiPathMisplaced},
		{"wiki/overview.md", WikiPathReservedTopLevel},
		{"wiki/index.md", WikiPathReservedTopLevel},
		{"wiki/log.md", WikiPathReservedTopLevel},
		{"wiki/templates/entity.md", WikiPathSystem},
		{"wiki/random/foo.md", WikiPathOther},
	}
	for _, tc := range tests {
		if got := ClassifyWikiPath(tc.path); got != tc.want {
			t.Errorf("ClassifyWikiPath(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

func TestValidateWikiWritePath(t *testing.T) {
	for _, path := range []string{
		"wiki/entities/dsp.md",
		"wiki/overview.md",
		"wiki/index.md",
		"wiki/log.md",
	} {
		if err := ValidateWikiWritePath(path); err != nil {
			t.Errorf("ValidateWikiWritePath(%q) = %v, want nil", path, err)
		}
	}

	for _, path := range []string{
		"wiki/dsp.md",
		"wiki/templates/entity.md",
		"wiki/random/foo.md",
	} {
		if err := ValidateWikiWritePath(path); err == nil {
			t.Errorf("ValidateWikiWritePath(%q) expected error", path)
		}
	}
}

func TestMisplacedWikiPageMessage(t *testing.T) {
	msg := MisplacedWikiPageMessage("wiki/dsp.md", "entity")
	if msg == "" || !strings.Contains(msg, "wiki/entities/") {
		t.Fatalf("unexpected message: %q", msg)
	}
}

func TestWikiPageTypeUsesClassification(t *testing.T) {
	if got := WikiPageType("wiki/templates/entity.md"); got != "template" {
		t.Fatalf("WikiPageType templates = %q", got)
	}
	if got := WikiPageType("wiki/dsp.md"); got != "page" {
		t.Fatalf("WikiPageType misplaced = %q", got)
	}
}

func TestIsHiddenWikiSubdir(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"wiki/templates/entity.md", true},
		{"wiki/templates/concept.md", true},
		{"wiki/sources/paper.md", true},
		{"wiki/entities/foo.md", false},
		{"wiki/concepts/bar.md", false},
		{"wiki/synthesis/analysis.md", false},
		{"wiki/comparisons/compare.md", false},
		{"wiki/queries/question.md", false},
		{"wiki/overview.md", false},
		{"raw/sources/file.pdf", false},
	}
	for _, tc := range tests {
		if got := IsHiddenWikiSubdir(tc.path); got != tc.want {
			t.Errorf("IsHiddenWikiSubdir(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}
