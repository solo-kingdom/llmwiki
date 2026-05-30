package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const indexRelPath = "wiki/index.md"

type wikiSubdir struct {
	dir     string
	heading string
}

var wikiSubdirs = []wikiSubdir{
	{dir: "entities", heading: "实体 (entities)"},
	{dir: "concepts", heading: "概念 (concepts)"},
	{dir: "sources", heading: "源摘要 (sources)"},
	{dir: "synthesis", heading: "综合分析 (synthesis)"},
	{dir: "comparisons", heading: "对比分析 (comparisons)"},
	{dir: "queries", heading: "查询归档 (queries)"},
}

// IndexEntry represents one row in wiki/index.md.
type IndexEntry struct {
	Subdir      string
	Slug        string
	Title       string
	Description string
	Date        string
}

// IndexBuilder generates wiki/index.md from wiki page frontmatter.
type IndexBuilder struct {
	workspace string
}

// NewIndexBuilder creates an index builder for the given workspace root.
func NewIndexBuilder(workspace string) *IndexBuilder {
	return &IndexBuilder{workspace: workspace}
}

// BuildIndex returns the full markdown content for wiki/index.md.
func (b *IndexBuilder) BuildIndex() (string, error) {
	date := time.Now().Format("2006-01-02")
	entries, err := b.scanWikiPages()
	if err != nil {
		return "", err
	}
	return b.buildIndexContent(date, entries), nil
}

func (b *IndexBuilder) buildIndexContent(date string, entriesBySubdir map[string][]IndexEntry) string {
	var sb strings.Builder
	sb.WriteString("---\n")
	sb.WriteString("title: 内容目录\n")
	sb.WriteString("type: index\n")
	sb.WriteString(fmt.Sprintf("date: %s\n", date))
	sb.WriteString("---\n\n")
	sb.WriteString("# 内容目录\n\n")
	sb.WriteString("> 本文件由 `llmwiki reindex` 自动维护，请勿手动编辑。\n\n")

	for _, sub := range wikiSubdirs {
		sb.WriteString(fmt.Sprintf("## %s\n\n", sub.heading))
		sb.WriteString("| 页面 | 标题 | 摘要 | 更新日期 |\n")
		sb.WriteString("|------|------|------|----------|\n")

		var entries []IndexEntry
		if entriesBySubdir != nil {
			entries = entriesBySubdir[sub.dir]
		}
		for _, e := range entries {
			link := fmt.Sprintf(
				"[[%s/%s\\|%s]]",
				e.Subdir,
				e.Slug,
				escapeGFMTableCell(e.Title),
			)
			sb.WriteString(fmt.Sprintf(
				"| %s | %s | %s | %s |\n",
				link,
				escapeGFMTableCell(e.Title),
				escapeGFMTableCell(e.Description),
				escapeGFMTableCell(e.Date),
			))
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

func (b *IndexBuilder) scanWikiPages() (map[string][]IndexEntry, error) {
	result := make(map[string][]IndexEntry)
	for _, sub := range wikiSubdirs {
		dirPath := filepath.Join(b.workspace, "wiki", sub.dir)
		entries, err := b.scanSubdir(sub.dir, dirPath)
		if err != nil {
			return nil, err
		}
		if len(entries) > 0 {
			result[sub.dir] = entries
		}
	}
	return result, nil
}

func (b *IndexBuilder) scanSubdir(subdir, dirPath string) ([]IndexEntry, error) {
	info, err := os.Stat(dirPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("stat %s: %w", dirPath, err)
	}
	if !info.IsDir() {
		return nil, nil
	}

	files, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("read dir %s: %w", dirPath, err)
	}

	var entries []IndexEntry
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		name := f.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			continue
		}
		if name == "index.md" || name == "log.md" || name == "overview.md" {
			continue
		}

		fullPath := filepath.Join(dirPath, name)
		entry, err := b.entryFromFile(subdir, name, fullPath)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Slug < entries[j].Slug
	})
	return entries, nil
}

func (b *IndexBuilder) entryFromFile(subdir, filename, fullPath string) (IndexEntry, error) {
	slug := strings.TrimSuffix(filename, filepath.Ext(filename))

	data, err := os.ReadFile(fullPath)
	if err != nil {
		return IndexEntry{}, fmt.Errorf("read %s: %w", fullPath, err)
	}

	fm := ParseFrontmatter(string(data))
	title := TitleFromFilename(filename)
	if fm.Title != "" {
		title = fm.Title
	}

	description := truncateRunes(fm.Description, 80)

	date := fm.Date
	if date == "" {
		info, err := os.Stat(fullPath)
		if err != nil {
			return IndexEntry{}, fmt.Errorf("stat %s: %w", fullPath, err)
		}
		date = info.ModTime().Format("2006-01-02")
	} else if len(date) > 10 {
		date = date[:10]
	}

	return IndexEntry{
		Subdir:      subdir,
		Slug:        slug,
		Title:       title,
		Description: description,
		Date:        date,
	}, nil
}

// escapeGFMTableCell escapes literal pipe characters for GFM table cells.
func escapeGFMTableCell(s string) string {
	return strings.ReplaceAll(s, "|", "\\|")
}

func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max]) + "…"
}

// WriteIndex builds and writes wiki/index.md.
func (b *IndexBuilder) WriteIndex() error {
	content, err := b.BuildIndex()
	if err != nil {
		return err
	}
	path := filepath.Join(b.workspace, indexRelPath)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create wiki dir: %w", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", indexRelPath, err)
	}
	return nil
}

// RebuildIndex is an alias for WriteIndex.
func (b *IndexBuilder) RebuildIndex() error {
	return b.WriteIndex()
}
