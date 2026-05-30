package engine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIndexBuilderEmptyWorkspace(t *testing.T) {
	ws := t.TempDir()
	b := NewIndexBuilder(ws)

	content, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("BuildIndex: %v", err)
	}
	for _, heading := range []string{
		"## 实体 (entities)",
		"## 概念 (concepts)",
		"## 源摘要 (sources)",
		"## 综合分析 (synthesis)",
		"## 对比分析 (comparisons)",
		"## 查询归档 (queries)",
	} {
		if !strings.Contains(content, heading) {
			t.Errorf("expected heading %q in index", heading)
		}
	}
	if !strings.Contains(content, "title: 内容目录") {
		t.Error("expected Chinese index title in frontmatter")
	}
}

func TestIndexBuilderMultiplePagesGrouped(t *testing.T) {
	ws := t.TempDir()
	writePage(t, ws, "wiki/entities/alpha.md", `---
title: Alpha Entity
description: First entity
date: "2024-03-01"
---
# Alpha`)
	writePage(t, ws, "wiki/concepts/beta.md", `---
title: Beta Concept
description: A concept page
date: "2024-03-02"
---
# Beta`)

	b := NewIndexBuilder(ws)
	content, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("BuildIndex: %v", err)
	}
	if !strings.Contains(content, "[[entities/alpha\\|Alpha Entity]]") {
		t.Errorf("missing entities link with escaped pipe, got:\n%s", content)
	}
	if !strings.Contains(content, "[[concepts/beta\\|Beta Concept]]") {
		t.Errorf("missing concepts link with escaped pipe, got:\n%s", content)
	}
	if !strings.Contains(content, "| Alpha Entity | First entity | 2024-03-01 |") {
		t.Error("expected entity row with frontmatter fields")
	}
	assertIndexTableRowColumns(t, content, "[[entities/alpha\\|Alpha Entity]] | Alpha Entity | First entity | 2024-03-01 |", 4)
}

func TestIndexBuilderFrontmatterFallback(t *testing.T) {
	ws := t.TempDir()
	path := filepath.Join(ws, "wiki", "sources", "my-source.md")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte("# No frontmatter\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	b := NewIndexBuilder(ws)
	content, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("BuildIndex: %v", err)
	}
	if !strings.Contains(content, "[[sources/my-source\\|My Source]]") {
		t.Errorf("expected title from filename, got:\n%s", content)
	}
}

func TestIndexBuilderIdempotent(t *testing.T) {
	ws := t.TempDir()
	writePage(t, ws, "wiki/entities/stable.md", `---
title: Stable
description: Same
date: "2024-01-01"
---
# Stable`)

	b := NewIndexBuilder(ws)
	first, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("first BuildIndex: %v", err)
	}
	second, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("second BuildIndex: %v", err)
	}
	if normalizeIndexForCompare(first) != normalizeIndexForCompare(second) {
		t.Errorf("index content not idempotent:\nfirst:\n%s\nsecond:\n%s", first, second)
	}
}

func TestIndexBuilderExcludesTemplatesAndMisplacedPages(t *testing.T) {
	ws := t.TempDir()
	writePage(t, ws, "wiki/templates/entity.md", `---
title: Template
---
# Template`)
	writePage(t, ws, "wiki/dsp.md", `---
title: DSP
---
# DSP`)
	writePage(t, ws, "wiki/entities/page.md", `---
title: Real Page
---
# Page`)

	b := NewIndexBuilder(ws)
	content, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("BuildIndex: %v", err)
	}
	if strings.Contains(content, "templates/entity") || strings.Contains(content, "[[templates/") {
		t.Error("template should not appear in index entries")
	}
	if strings.Contains(content, "dsp") {
		t.Error("misplaced top-level page should not appear in index entries")
	}
	if !strings.Contains(content, "[[entities/page\\|Real Page]]") {
		t.Error("expected typed page in index")
	}
}

func TestIndexBuilderEscapesPipesInTableCells(t *testing.T) {
	ws := t.TempDir()
	writePage(t, ws, "wiki/entities/pipe-title.md", `---
title: "Alpha|Beta"
description: "Summary|note"
date: "2024-03-01"
---
# Pipe`)
	writePage(t, ws, "wiki/entities/normal.md", `---
title: Normal Entity
description: Plain summary
date: "2024-03-02"
---
# Normal`)

	b := NewIndexBuilder(ws)
	content, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("BuildIndex: %v", err)
	}

	expectedRow := "[[entities/pipe-title\\|Alpha\\|Beta]] | Alpha\\|Beta | Summary\\|note | 2024-03-01 |"
	if !strings.Contains(content, expectedRow) {
		t.Errorf("expected escaped pipe row, got:\n%s", content)
	}
	assertIndexTableRowColumns(t, content, expectedRow, 4)
	assertIndexTableRowColumns(t, content, "[[entities/normal\\|Normal Entity]] | Normal Entity | Plain summary | 2024-03-02 |", 4)
}

func TestIndexBuilderExcludesNavPages(t *testing.T) {
	ws := t.TempDir()
	writePage(t, ws, "wiki/overview.md", `---
title: Overview
---
# Overview`)
	writePage(t, ws, "wiki/entities/page.md", `---
title: Real Page
---
# Page`)

	b := NewIndexBuilder(ws)
	content, err := b.BuildIndex()
	if err != nil {
		t.Fatalf("BuildIndex: %v", err)
	}
	if strings.Contains(content, "overview") {
		t.Error("overview.md should not appear in index entries")
	}
	if !strings.Contains(content, "[[entities/page\\|Real Page]]") {
		t.Error("expected real page in index")
	}
}

func TestIndexBuilderWriteIndex(t *testing.T) {
	ws := t.TempDir()
	b := NewIndexBuilder(ws)
	if err := b.WriteIndex(); err != nil {
		t.Fatalf("WriteIndex: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(ws, "wiki", "index.md"))
	if err != nil {
		t.Fatalf("ReadFile index.md: %v", err)
	}
	if !strings.Contains(string(data), "# 内容目录") {
		t.Errorf("unexpected index content: %s", data)
	}
}

func TestTruncateRunes(t *testing.T) {
	got := truncateRunes("一二三四五六七八九十", 5)
	if got != "一二三四五…" {
		t.Errorf("truncateRunes = %q", got)
	}
}

func writePage(t *testing.T, ws, rel, content string) {
	t.Helper()
	path := filepath.Join(ws, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
}

func normalizeIndexForCompare(s string) string {
	lines := strings.Split(s, "\n")
	var out []string
	for _, line := range lines {
		if strings.HasPrefix(line, "date:") {
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func assertIndexTableRowColumns(t *testing.T, content, rowFragment string, wantCols int) {
	t.Helper()
	for _, line := range strings.Split(content, "\n") {
		if !strings.Contains(line, rowFragment) {
			continue
		}
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "|") || !strings.HasSuffix(trimmed, "|") {
			t.Fatalf("expected table row for %q, got %q", rowFragment, line)
		}
		gotCols := countGFMTableColumns(trimmed)
		if gotCols != wantCols {
			t.Errorf("row %q has %d columns, want %d", line, gotCols, wantCols)
		}
		return
	}
	t.Fatalf("row containing %q not found in index content", rowFragment)
}

func countGFMTableColumns(row string) int {
	inner := strings.Trim(strings.TrimSpace(row), "|")
	cols := 1
	escaped := false
	for _, r := range inner {
		if escaped {
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if r == '|' {
			cols++
		}
	}
	return cols
}
