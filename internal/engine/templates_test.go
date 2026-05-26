package engine

import (
	"strings"
	"testing"
)

func TestWikiPageTemplateFiles(t *testing.T) {
	files := WikiPageTemplateFiles()
	want := []string{
		"wiki/templates/entity.md",
		"wiki/templates/concept.md",
		"wiki/templates/source.md",
		"wiki/templates/synthesis.md",
		"wiki/templates/comparison.md",
		"wiki/templates/query.md",
	}
	if len(files) != len(want) {
		t.Fatalf("expected %d templates, got %d", len(want), len(files))
	}
	for _, rel := range want {
		content, ok := files[rel]
		if !ok {
			t.Fatalf("missing template %s", rel)
		}
		if !strings.Contains(content, "Required Sections") {
			t.Errorf("%s missing Required Sections comment", rel)
		}
		if !strings.Contains(content, "type:") {
			t.Errorf("%s missing type frontmatter", rel)
		}
	}
}

func TestEntityTemplateSections(t *testing.T) {
	for _, want := range []string{"概述", "关键事实", "相关概念", "来源"} {
		if !strings.Contains(entityTemplateMD, want) {
			t.Errorf("entity template missing section %q", want)
		}
	}
}

func TestConceptTemplateSections(t *testing.T) {
	for _, want := range []string{"定义", "核心要点", "相关实体", "来源"} {
		if !strings.Contains(conceptTemplateMD, want) {
			t.Errorf("concept template missing section %q", want)
		}
	}
}

func TestSourceTemplateSections(t *testing.T) {
	for _, want := range []string{"摘要", "关键观点", "相关实体/概念"} {
		if !strings.Contains(sourceTemplateMD, want) {
			t.Errorf("source template missing section %q", want)
		}
	}
}

func TestSynthesisTemplateSections(t *testing.T) {
	for _, want := range []string{"问题/目的", "分析", "引用", "后续"} {
		if !strings.Contains(synthesisTemplateMD, want) {
			t.Errorf("synthesis template missing section %q", want)
		}
	}
}

func TestComparisonTemplateSections(t *testing.T) {
	for _, want := range []string{"对比维度", "异同", "结论"} {
		if !strings.Contains(comparisonTemplateMD, want) {
			t.Errorf("comparison template missing section %q", want)
		}
	}
}

func TestQueryTemplateSections(t *testing.T) {
	for _, want := range []string{"问题", "回答", "引用"} {
		if !strings.Contains(queryTemplateMD, want) {
			t.Errorf("query template missing section %q", want)
		}
	}
}

func TestTemplateGuidanceForGeneration(t *testing.T) {
	zh := TemplateGuidanceForGeneration("zh")
	for _, want := range []string{
		"页面类型、必需章节与允许目录",
		"entity → wiki/entities/",
		"概述、关键事实、相关概念、来源",
		"不得写入 wiki/ 顶层",
		"wiki/templates/",
	} {
		if !strings.Contains(zh, want) {
			t.Errorf("zh guidance missing %q:\n%s", want, zh)
		}
	}

	en := TemplateGuidanceForGeneration("en")
	for _, want := range []string{
		"Page types, required sections, and allowed directories",
		"entity → wiki/entities/",
		"Overview, Key Facts, Related Concepts, Sources",
		"MUST NOT be written as top-level wiki/*.md",
		"wiki/templates/",
	} {
		if !strings.Contains(en, want) {
			t.Errorf("en guidance missing %q:\n%s", want, en)
		}
	}
}
