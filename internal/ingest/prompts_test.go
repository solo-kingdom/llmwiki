package ingest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestComposeSystemPromptEntityConceptSeparation(t *testing.T) {
	dir := t.TempDir()
	ctx := PromptContext{Workspace: dir, DocLang: "zh"}

	analysis := ComposeSystemPrompt(StepAnalysis, ctx)
	for _, want := range []string{
		"实体",
		"概念",
		"关系",
		"AppLovin组织裁剪方法论",
		"不要当作单个概念页",
	} {
		if !strings.Contains(analysis, want) {
			t.Errorf("analysis prompt missing %q", want)
		}
	}

	generation := ComposeSystemPrompt(StepGeneration, ctx)
	for _, want := range []string{
		"概念页标题默认保持中性",
		"wikilink",
		"组织裁剪方法论",
		"AppLovin",
	} {
		if !strings.Contains(generation, want) {
			t.Errorf("generation prompt missing %q", want)
		}
	}

	organize := ComposeSystemPrompt(StepSessionOrganize, ctx)
	if !strings.Contains(organize, "entity_concept_coupling") {
		t.Fatalf("organize prompt missing entity_concept_coupling guidance: %s", organize)
	}

	enAnalysis := ComposeSystemPrompt(StepAnalysis, PromptContext{Workspace: dir, DocLang: "en"})
	if !strings.Contains(enAnalysis, "entity name + abstract concept") {
		t.Fatalf("english analysis prompt missing separation guidance: %s", enAnalysis)
	}
}

func TestComposeSystemPromptGenerationTemplateGuidance(t *testing.T) {
	ctx := PromptContext{Workspace: t.TempDir(), DocLang: "zh"}
	out := ComposeSystemPrompt(StepGeneration, ctx)
	for _, want := range []string{
		"页面类型、必需章节与允许目录",
		"entity → wiki/entities/",
		"concept → wiki/concepts/",
		"不得写入 wiki/ 顶层",
		"wiki/templates/",
		"中文",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("generation prompt missing %q:\n%s", want, out)
		}
	}
}

func TestComposeSystemPromptGenerationEnglish(t *testing.T) {
	ctx := PromptContext{Workspace: t.TempDir(), DocLang: "en"}
	out := ComposeSystemPrompt(StepGeneration, ctx)
	for _, want := range []string{
		"entity → wiki/entities/",
		"MUST NOT be written as top-level wiki/*.md",
		"English",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("generation prompt missing %q:\n%s", want, out)
		}
	}
}

func TestComposeSystemPromptPlanAndOrganizeLanguage(t *testing.T) {
	zhOrganize := ComposeSystemPrompt(StepSessionOrganize, PromptContext{Workspace: t.TempDir(), DocLang: "zh"})
	if !strings.Contains(zhOrganize, "架构师") {
		t.Fatalf("expected Chinese organize prompt: %s", zhOrganize)
	}

	enPlan := ComposeSystemPrompt(StepPlanOrganize, PromptContext{Workspace: t.TempDir(), DocLang: "en"})
	if !strings.Contains(enPlan, "reorganization planner") {
		t.Fatalf("expected English organize plan prompt: %s", enPlan)
	}

	zhRollback := ComposeSystemPrompt(StepRollback, PromptContext{Workspace: t.TempDir(), DocLang: "zh"})
	if !strings.Contains(zhRollback, "回滚助手") || !strings.Contains(zhRollback, "中文") {
		t.Fatalf("expected Chinese rollback prompt: %s", zhRollback)
	}

	enMerge := ComposeSystemPrompt(StepMergeBody, PromptContext{Workspace: t.TempDir(), DocLang: "en"})
	if !strings.Contains(enMerge, "Merge old and new wiki body text") || !strings.Contains(enMerge, "English") {
		t.Fatalf("expected English merge prompt: %s", enMerge)
	}
}

func TestComposeSystemPromptLockedAndFidelity(t *testing.T) {
	ctx := PromptContext{Workspace: t.TempDir(), DocLang: "zh"}
	out := ComposeSystemPrompt(StepGeneration, ctx)
	for _, want := range []string{"【格式契约", "【内容忠实性", "wiki 页面生成器", "FILE 块", "中文"} {
		if !strings.Contains(out, want) {
			t.Errorf("prompt missing %q:\n%s", want, out)
		}
	}
}

func TestComposeSystemPromptWorkspaceFiles(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "purpose.md"), []byte("# 研究目标\n测试目的"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "rules.md"), []byte("# 规则\n仅写实体页"), 0o644)

	ctx := PromptContext{Workspace: dir, DocLang: "zh", RulesSupplement: "临时：不要写 synthesis"}
	out := ComposeSystemPrompt(StepAnalysis, ctx)
	for _, want := range []string{"研究目标", "规则", "rules_supplement", "临时：不要写 synthesis"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in prompt", want)
		}
	}
}

func TestComposeSystemPromptYAMLAppendOnly(t *testing.T) {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, ".llmwiki"), 0o755)
	yaml := `version: 1
steps:
  generation:
    append: |
      额外：优先更新 entity 页
`
	_ = os.WriteFile(filepath.Join(dir, ".llmwiki", "prompts.yaml"), []byte(yaml), 0o644)

	ctx := PromptContext{Workspace: dir, DocLang: "zh"}
	out := ComposeSystemPrompt(StepGeneration, ctx)
	if !strings.Contains(out, "优先更新 entity 页") {
		t.Fatalf("expected yaml append in prompt: %s", out)
	}
}

func TestTruncateUTF8(t *testing.T) {
	s := strings.Repeat("测", 2000)
	got := truncateUTF8(s, 100)
	if len([]rune(got)) > 120 {
		t.Fatalf("expected truncation around 100 runes, got %d", len([]rune(got)))
	}
}

func TestValidateRulesSupplement(t *testing.T) {
	if err := ValidateRulesSupplement(strings.Repeat("a", 2048)); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRulesSupplement(strings.Repeat("a", 2049)); err == nil {
		t.Fatal("expected error for long supplement")
	}
}

func TestComputeRulesHashChanges(t *testing.T) {
	dir := t.TempDir()
	h1 := ComputeRulesHash(dir, "")
	_ = os.WriteFile(filepath.Join(dir, "rules.md"), []byte("x"), 0o644)
	h2 := ComputeRulesHash(dir, "")
	if h1 == h2 {
		t.Fatal("hash should change when rules.md added")
	}
}

func TestWriteWorkspaceScaffoldsIfMissing(t *testing.T) {
	dir := t.TempDir()
	if err := WriteWorkspaceScaffoldsIfMissing(dir); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"rules.md", ".llmwiki/prompts.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, rel)); err != nil {
			t.Fatalf("missing %s: %v", rel, err)
		}
	}
	// idempotent
	if err := WriteWorkspaceScaffoldsIfMissing(dir); err != nil {
		t.Fatal(err)
	}
}
