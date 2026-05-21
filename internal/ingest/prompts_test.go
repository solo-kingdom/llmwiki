package ingest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
