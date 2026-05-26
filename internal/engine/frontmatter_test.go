package engine

import (
	"testing"
)

func TestParseFrontmatter(t *testing.T) {
	content := `---
title: My Page
date: "2024-01-15"
tags:
  - golang
  - wiki
description: A test page
---

# Content here
`

	fm := ParseFrontmatter(content)
	if fm.Title != "My Page" {
		t.Errorf("expected Title='My Page', got %q", fm.Title)
	}
	if fm.Date != "2024-01-15" {
		t.Errorf("expected Date='2024-01-15', got %q", fm.Date)
	}
	if len(fm.Tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(fm.Tags))
	}
	if fm.Tags[0] != "golang" || fm.Tags[1] != "wiki" {
		t.Errorf("expected tags ['golang','wiki'], got %v", fm.Tags)
	}
	if fm.Description != "A test page" {
		t.Errorf("expected Description='A test page', got %q", fm.Description)
	}
}

func TestParseFrontmatterEmpty(t *testing.T) {
	fm := ParseFrontmatter("Just some content without frontmatter")
	if fm.Title != "" {
		t.Errorf("expected empty Title, got %q", fm.Title)
	}
	if fm.Tags != nil && len(fm.Tags) != 0 {
		t.Errorf("expected empty Tags, got %v", fm.Tags)
	}
}

func TestParseFrontmatterInvalid(t *testing.T) {
	content := `---
invalid: [yaml: content
---

Text`
	fm := ParseFrontmatter(content)
	// Should return empty Frontmatter on parse error
	if fm.Title != "" {
		t.Errorf("expected empty Title on invalid YAML, got %q", fm.Title)
	}
}

func TestParseFrontmatterMinimal(t *testing.T) {
	content := `---
title: Simple
---

Body text`

	fm := ParseFrontmatter(content)
	if fm.Title != "Simple" {
		t.Errorf("expected Title='Simple', got %q", fm.Title)
	}
}

func TestGetDate(t *testing.T) {
	fm := Frontmatter{Date: "2024-06-01"}
	if got := fm.GetDate(); got != "2024-06-01" {
		t.Errorf("expected '2024-06-01', got %q", got)
	}
}

func TestGetTagsString(t *testing.T) {
	tests := []struct {
		name string
		tags []string
		want string
	}{
		{"empty", nil, "[]"},
		{"empty slice", []string{}, "[]"},
		{"single", []string{"go"}, `["go"]`},
		{"multiple", []string{"a", "b", "c"}, `["a","b","c"]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fm := Frontmatter{Tags: tt.tags}
			got := fm.GetTagsString()
			if got != tt.want {
				t.Errorf("GetTagsString() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGetMetadataJSON(t *testing.T) {
	fm := Frontmatter{Description: "test desc"}
	got := fm.GetMetadataJSON()
	if got != `{"description":"test desc"}` {
		t.Errorf("expected metadata JSON, got %q", got)
	}

	fmEmpty := Frontmatter{}
	if got := fmEmpty.GetMetadataJSON(); got != "{}" {
		t.Errorf("expected '{}', got %q", got)
	}
}

func TestTitleFromFilename(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"my-page.md", "My Page"},
		{"hello_world.txt", "Hello World"},
		{"README.md", "README"},
		{"some-long-file-name.md", "Some Long File Name"},
		{"UPPER.md", "UPPER"},
		{"a.md", "A"},
	}
	for _, tt := range tests {
		got := TitleFromFilename(tt.input)
		if got != tt.want {
			t.Errorf("TitleFromFilename(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
