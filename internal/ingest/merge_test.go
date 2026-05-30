package ingest

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

func newMergeLLMClient(t *testing.T, resp string) *llm.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", openAIStreamChunk(resp))
		fmt.Fprintf(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)
	return llm.NewClient(llm.Config{
		Provider: "openai",
		BaseURL:  srv.URL + "/v1",
		Model:    "test-model",
	})
}

func TestMergeFrontmatterLockedAndUnion(t *testing.T) {
	oldYAML := `title: Old Title
type: entity
created: 2024-01-01
tags: [alpha, beta]
sources: [raw/a.md]
related: [[entities/foo]]
date: 2024-06-01
description: old desc
`
	newYAML := `title: New Title
type: concept
created: 2025-01-01
tags: [beta, gamma]
sources: [raw/b.md]
related: [[entities/bar]]
date: 2025-03-01
description: new desc
custom: from-new
`
	merged, err := mergeFrontmatter(oldYAML, newYAML)
	if err != nil {
		t.Fatalf("mergeFrontmatter: %v", err)
	}
	m := parseYAMLMap(merged)

	if m["title"] != "Old Title" {
		t.Errorf("title = %v, want Old Title", m["title"])
	}
	if m["type"] != "entity" {
		t.Errorf("type = %v, want entity", m["type"])
	}
	if s := fmt.Sprint(m["created"]); !strings.Contains(s, "2024-01-01") {
		t.Errorf("created = %v, want 2024-01-01", m["created"])
	}

	tags := stringSliceFromYAML(m["tags"])
	if len(tags) != 3 {
		t.Errorf("tags = %v, want 3 unioned entries", tags)
	}

	sources := stringSliceFromYAML(m["sources"])
	if len(sources) != 2 {
		t.Errorf("sources = %v", sources)
	}

	if m["description"] != "new desc" {
		t.Errorf("description = %v, want new desc", m["description"])
	}
	if s := fmt.Sprint(m["date"]); !strings.Contains(s, "2025-03-01") {
		t.Errorf("date = %v, want 2025-03-01", m["date"])
	}
	if m["custom"] != "from-new" {
		t.Errorf("custom = %v, want from-new", m["custom"])
	}
}

func TestMergeWikiPageSkipIdentical(t *testing.T) {
	ws := t.TempDir()
	path := filepath.Join(ws, "wiki", "same.md")
	content := "---\ntitle: T\ntype: entity\ndate: 2024-01-01\n---\n# Body\n"
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	_, skip, err := MergeWikiPage(context.Background(), path, content, &MergeContext{})
	if err != nil {
		t.Fatalf("MergeWikiPage: %v", err)
	}
	if !skip {
		t.Fatal("expected skip for identical content")
	}
}

func TestMergeBodyLLMLengthGuard(t *testing.T) {
	oldBody := strings.Repeat("重要旧内容段落。", 50)
	client := newMergeLLMClient(t, "太短了")
	mc := &MergeContext{LLMClient: client, DocLang: "zh"}

	_, err := mergeBodyLLM(context.Background(), mc, oldBody, "新内容增量")
	if err == nil {
		t.Fatal("expected length guard error")
	}
	if !strings.Contains(err.Error(), "too aggressive") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestMergeBodyLLMSuccess(t *testing.T) {
	oldBody := strings.Repeat("旧段落内容。", 30)
	newBody := "新段落。"
	mergedResp := oldBody + "\n\n" + newBody

	client := newMergeLLMClient(t, mergedResp)
	mc := &MergeContext{LLMClient: client, DocLang: "zh"}

	got, err := mergeBodyLLM(context.Background(), mc, oldBody, newBody)
	if err != nil {
		t.Fatalf("mergeBodyLLM: %v", err)
	}
	if got != mergedResp {
		t.Fatalf("got %q, want %q", got, mergedResp)
	}
}

func TestApplyWikiBlocksForceOverwriteSkipsMerge(t *testing.T) {
	ws := t.TempDir()
	existing := "---\ntitle: Locked\ntype: entity\ndate: 2024-01-01\n---\n# Old Body\n"
	path := filepath.Join(ws, "wiki", "entities", "x.md")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}

	blocks := map[string]string{
		"wiki/entities/x.md": "---\ntitle: Overwrite\ntype: concept\ndate: 2025-01-01\n---\n# New Only\n",
	}
	opts := &ApplyWikiBlocksOpts{
		ForceOverwrite: true,
		Merge:          &MergeContext{LLMClient: newMergeLLMClient(t, "unused")},
	}
	result, err := ApplyWikiBlocks(context.Background(), ws, blocks, opts)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}
	if len(result.Written) != 1 {
		t.Fatalf("paths = %v", result.Written)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "New Only") {
		t.Fatalf("expected overwrite, got %q", string(data))
	}
	if strings.Contains(string(data), "Old Body") {
		t.Fatal("force overwrite should not preserve old body")
	}
}

func TestApplyWikiBlocksMergePreservesLockedFields(t *testing.T) {
	ws := t.TempDir()
	existing := "---\ntitle: Locked Title\ntype: entity\ncreated: 2024-01-01\ndate: 2024-06-01\n---\n# Old Body\n"
	path := filepath.Join(ws, "wiki", "entities", "x.md")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}

	mergedBody := strings.Repeat("合并后正文保留旧内容。", 40)
	client := newMergeLLMClient(t, mergedBody)
	blocks := map[string]string{
		"wiki/entities/x.md": "---\ntitle: New Title\ntype: concept\ncreated: 2025-01-01\ndate: 2025-03-01\n---\n# New Body\n",
	}
	opts := &ApplyWikiBlocksOpts{
		Merge: &MergeContext{LLMClient: client, DocLang: "zh"},
	}
	_, err := ApplyWikiBlocks(context.Background(), ws, blocks, opts)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(data)
	if !strings.Contains(s, "Locked Title") {
		t.Errorf("expected locked title preserved, got %q", s)
	}
	if !strings.Contains(s, "type: entity") {
		t.Errorf("expected locked type preserved, got %q", s)
	}
	if strings.Contains(s, "# New Body") {
		t.Error("raw new body should not appear after LLM merge")
	}
	if !strings.Contains(s, mergedBody) {
		t.Errorf("expected merged body, got %q", s)
	}
}

func TestApplyWikiBlocksIdenticalContentSkipsWrite(t *testing.T) {
	ws := t.TempDir()
	content := "---\ntitle: T\ntype: entity\ndate: 2024-01-01\n---\n# Same\n"
	path := filepath.Join(ws, "wiki", "entities", "skip.md")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	blocks := map[string]string{"wiki/entities/skip.md": content}
	opts := &ApplyWikiBlocksOpts{
		Merge: &MergeContext{LLMClient: newMergeLLMClient(t, "should not be called")},
	}
	result, err := ApplyWikiBlocks(context.Background(), ws, blocks, opts)
	if err != nil {
		t.Fatalf("ApplyWikiBlocks: %v", err)
	}
	if len(result.Written) != 0 {
		t.Fatalf("expected no writes, got paths %v", result.Written)
	}
}
