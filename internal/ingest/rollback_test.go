package ingest

import (
	"testing"
)

func TestBuildRollbackPrompt(t *testing.T) {
	ctx := &RollbackContext{
		Diff:              "diff --git a/wiki/page.md b/wiki/page.md\n+new content",
		NormalizedContent: "original source content",
		AffectedFiles:     []string{"wiki/page.md"},
		SourceFilename:    "doc.pdf",
		CommitSHA:         "abc1234",
	}

	currentFiles := map[string]string{
		"wiki/page.md": "# Page\nnew content",
	}

	prompt := buildRollbackPrompt(ctx, currentFiles, "zh")

	if prompt == "" {
		t.Fatal("expected non-empty prompt")
	}
	if !contains(prompt, "original source content") {
		t.Error("prompt should contain normalized content")
	}
	if !contains(prompt, "wiki/page.md") {
		t.Error("prompt should contain affected file path")
	}
	if !contains(prompt, "# Page\nnew content") {
		t.Error("prompt should contain current file content")
	}
}

func TestParseDiffFiles(t *testing.T) {
	diff := `diff --git a/wiki/intro.md b/wiki/intro.md
new file mode 100644
--- /dev/null
+++ b/wiki/intro.md
@@ -0,0 +1,5 @@
+# Introduction
+Hello world
diff --git a/wiki/conclusion.md b/wiki/conclusion.md
--- a/wiki/conclusion.md
+++ b/wiki/conclusion.md`

	files := parseDiffFiles(diff)
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d: %v", len(files), files)
	}
	if files[0] != "wiki/intro.md" {
		t.Errorf("file[0] = %q, want wiki/intro.md", files[0])
	}
	if files[1] != "wiki/conclusion.md" {
		t.Errorf("file[1] = %q, want wiki/conclusion.md", files[1])
	}
}

func TestParseDiffFilesEmpty(t *testing.T) {
	files := parseDiffFiles("")
	if len(files) != 0 {
		t.Errorf("expected 0 files, got %d", len(files))
	}
}

func TestParseFileBlocksWithContent(t *testing.T) {
	output := `Here are the rollback files:

---FILE: wiki/page1.md
# Page 1
Original content
---END FILE---

---FILE: wiki/page2.md
---DELETE---
---END FILE---`

	blocks := parseFileBlocksWithContent(output)
	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(blocks))
	}

	content1, ok := blocks["wiki/page1.md"]
	if !ok {
		t.Fatal("expected wiki/page1.md in blocks")
	}
	if !contains(content1, "Original content") {
		t.Errorf("page1 content: %q", content1)
	}

	content2, ok := blocks["wiki/page2.md"]
	if !ok {
		t.Fatal("expected wiki/page2.md in blocks")
	}
	if content2 != "---DELETE---\n" {
		t.Errorf("page2 content: %q", content2)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
