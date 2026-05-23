package ingest

import (
	"strings"
	"testing"
)

func TestSplitSections_BasicHeadings(t *testing.T) {
	body := "Preamble text\n\n## First\nFirst content\n\n## Second\nSecond content"
	sections := SplitSections(body)

	if len(sections) != 3 {
		t.Fatalf("expected 3 sections, got %d", len(sections))
	}
	if sections[0].Heading != "" {
		t.Errorf("section 0 heading: expected empty, got %q", sections[0].Heading)
	}
	if !strings.Contains(sections[0].Content, "Preamble") {
		t.Errorf("section 0 content: expected preamble, got %q", sections[0].Content)
	}
	if sections[1].Heading != "## First" {
		t.Errorf("section 1 heading: expected ## First, got %q", sections[1].Heading)
	}
	if sections[2].Heading != "## Second" {
		t.Errorf("section 2 heading: expected ## Second, got %q", sections[2].Heading)
	}
}

func TestSplitSections_NoHeadings(t *testing.T) {
	body := "Just plain text\nNo headings here"
	sections := SplitSections(body)

	if len(sections) != 1 {
		t.Fatalf("expected 1 section, got %d", len(sections))
	}
	if sections[0].Heading != "" {
		t.Errorf("expected empty heading, got %q", sections[0].Heading)
	}
}

func TestSplitSections_MixedLevels(t *testing.T) {
	body := "## Top Level\nSome content\n### Sub Level\nSub content\n## Another Top\nMore content"
	sections := SplitSections(body)

	if len(sections) != 2 {
		t.Fatalf("expected 2 sections (### is content), got %d", len(sections))
	}
	if sections[0].Heading != "## Top Level" {
		t.Errorf("section 0 heading: got %q", sections[0].Heading)
	}
	// ### should be part of content, not a new section
	if !strings.Contains(sections[0].Content, "### Sub Level") {
		t.Errorf("section 0 content should contain ### heading, got: %q", sections[0].Content)
	}
}

func TestSplitSections_EmptyBody(t *testing.T) {
	sections := SplitSections("")
	if len(sections) != 0 {
		t.Errorf("expected 0 sections for empty body, got %d", len(sections))
	}

	sections = SplitSections("   \n  \n  ")
	if len(sections) != 0 {
		t.Errorf("expected 0 sections for whitespace-only body, got %d", len(sections))
	}
}

func TestDiffSections_ExactMatch(t *testing.T) {
	old := SplitSections("## A\nOld content A\n\n## B\nOld content B")
	new := SplitSections("## A\nOld content A\n\n## B\nNew content B")

	diffs := DiffSections(old, new)

	if len(diffs) != 2 {
		t.Fatalf("expected 2 diffs, got %d", len(diffs))
	}
	// Section A: unchanged
	if diffs[0].Type != "unchanged" {
		t.Errorf("section A: expected unchanged, got %s", diffs[0].Type)
	}
	// Section B: modified
	if diffs[1].Type != "modified" {
		t.Errorf("section B: expected modified, got %s", diffs[1].Type)
	}
}

func TestDiffSections_NewSection(t *testing.T) {
	old := SplitSections("## A\nContent A")
	new := SplitSections("## A\nContent A\n\n## B\nNew content B")

	diffs := DiffSections(old, new)

	hasNew := false
	for _, d := range diffs {
		if d.Type == "new" && d.New != nil && d.New.Heading == "## B" {
			hasNew = true
		}
	}
	if !hasNew {
		t.Errorf("expected a 'new' diff for section B, got: %v", diffs)
	}
}

func TestDiffSections_DeletedSection(t *testing.T) {
	old := SplitSections("## A\nContent A\n\n## B\nContent B")
	new := SplitSections("## A\nContent A")

	diffs := DiffSections(old, new)

	hasDeleted := false
	for _, d := range diffs {
		if d.Type == "deleted" && d.Old != nil && d.Old.Heading == "## B" {
			hasDeleted = true
		}
	}
	if !hasDeleted {
		t.Errorf("expected a 'deleted' diff for section B, got: %v", diffs)
	}
}

func TestDiffSections_ModifiedSection(t *testing.T) {
	old := SplitSections("## A\nOriginal content")
	new := SplitSections("## A\nUpdated content with more info")

	diffs := DiffSections(old, new)

	if len(diffs) != 1 {
		t.Fatalf("expected 1 diff, got %d", len(diffs))
	}
	if diffs[0].Type != "modified" {
		t.Errorf("expected modified, got %s", diffs[0].Type)
	}
}

func TestSectionSimilarity_Identical(t *testing.T) {
	sim := sectionSimilarity("hello world this is a test", "hello world this is a test")
	if sim != 1.0 {
		t.Errorf("expected 1.0 for identical text, got %f", sim)
	}
}

func TestSectionSimilarity_Different(t *testing.T) {
	sim := sectionSimilarity("completely different text here", "nothing matches at all really")
	if sim > 0.3 {
		t.Errorf("expected low similarity for different text, got %f", sim)
	}
}

func TestSectionSimilarity_Partial(t *testing.T) {
	sim := sectionSimilarity("the quick brown fox jumps over the lazy dog", "the quick brown fox walked around the park")
	if sim <= 0 || sim >= 1.0 {
		t.Errorf("expected partial similarity between 0 and 1, got %f", sim)
	}
}

func TestShouldUseDiffMerge_ShortContent(t *testing.T) {
	short := "short text"
	long := "this is much longer content with enough characters to potentially pass the threshold but still might not have headings"
	if shouldUseDiffMerge(short, long) {
		t.Error("expected false for short old content")
	}
}

func TestShouldUseDiffMerge_NoHeadings(t *testing.T) {
	a := strings.Repeat("word ", 100)
	b := strings.Repeat("other word ", 100)
	if shouldUseDiffMerge(a, b) {
		t.Error("expected false for content without ## headings")
	}
}

func TestShouldUseDiffMerge_NormalCase(t *testing.T) {
	old := "## Section A\n" + strings.Repeat("Content for section A. ", 30) +
		"\n\n## Section B\n" + strings.Repeat("Content for section B. ", 30)
	new := "## Section A\n" + strings.Repeat("Updated content for A. ", 30) +
		"\n\n## Section B\n" + strings.Repeat("Content for section B. ", 30)
	if !shouldUseDiffMerge(old, new) {
		t.Error("expected true for normal case with ## headings")
	}
}

func TestEditDistance(t *testing.T) {
	tests := []struct {
		a, b     string
		expected int
	}{
		{"", "", 0},
		{"abc", "abc", 0},
		{"abc", "abd", 1},
		{"abc", "abcd", 1},
		{"kitten", "sitting", 3},
	}
	for _, tt := range tests {
		got := editDistance(tt.a, tt.b)
		if got != tt.expected {
			t.Errorf("editDistance(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.expected)
		}
	}
}

func TestHeadingMatch(t *testing.T) {
	tests := []struct {
		a, b     string
		expected bool
	}{
		{"## Foo", "## Foo", true},
		{"## Foo", "## foo", true}, // case insensitive
		{"## Foo", "## Bar", false},
		{"", "", true},
		{"## 自注意力", "## 自注意力", true},
	}
	for _, tt := range tests {
		got := headingMatch(tt.a, tt.b)
		if got != tt.expected {
			t.Errorf("headingMatch(%q, %q) = %v, want %v", tt.a, tt.b, got, tt.expected)
		}
	}
}

func TestFormatSection(t *testing.T) {
	// Section with heading
	s := &Section{Heading: "## Title", Content: "Body text"}
	result := formatSection(s)
	if !strings.HasPrefix(result, "## Title\n") {
		t.Errorf("expected heading prefix, got: %q", result)
	}

	// Preamble without heading
	s2 := &Section{Heading: "", Content: "Preamble text"}
	result2 := formatSection(s2)
	if result2 != "Preamble text" {
		t.Errorf("expected just content, got: %q", result2)
	}
}
