package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// Tool definitions for organize mode diagnostics.

var auditTool = Tool{
	Name:        "audit",
	Description: "Run a comprehensive health check on the wiki. Returns issues (dead links, orphan pages, missing metadata) and statistics (page count, tag distribution, content length).",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"focus": map[string]interface{}{
				"type":        "string",
				"enum":        []string{"all", "structure", "content", "metadata", "links"},
				"default":     "all",
				"description": "Focus area for the audit",
			},
		},
		"required": []string{},
	},
}

var structureTool = Tool{
	Name:        "structure",
	Description: "Show the wiki directory tree with page counts, tag distribution, and empty directory markers.",
	InputSchema: map[string]interface{}{
		"type":       "object",
		"properties": map[string]interface{}{},
		"required":   []string{},
	},
}

var gapsTool = Tool{
	Name:        "gaps",
	Description: "Find knowledge coverage gaps. Modes: dangling (pages referenced but missing), uncited (source files not referenced by any wiki page).",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"mode": map[string]interface{}{
				"type":        "string",
				"enum":        []string{"dangling", "uncited", "all"},
				"default":     "all",
				"description": "Gap detection mode",
			},
		},
		"required": []string{},
	},
}

var similarTool = Tool{
	Name:        "similar",
	Description: "Find wiki pages with similar content that may be candidates for merging. Uses full-text search overlap to identify candidate pairs.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path": map[string]interface{}{
				"type":        "string",
				"description": "Find pages similar to this specific page (omit for global scan)",
			},
			"scan": map[string]interface{}{
				"type":        "boolean",
				"default":     false,
				"description": "Scan all wiki pages for similar pairs",
			},
			"limit": map[string]interface{}{
				"type":        "integer",
				"default":     50,
				"description": "Max pages to scan (global scan only)",
			},
		},
		"required": []string{},
	},
}

// --- audit implementation ---

func executeLocalAudit(workspace string, db *sqlite.DB, args map[string]interface{}) (string, error) {
	focus := "all"
	if f, ok := args["focus"].(string); ok && f != "" {
		focus = f
	}

	var sb strings.Builder
	sb.WriteString("# Wiki 诊断报告\n\n")

	// --- Statistics ---
	docs, err := db.ListDocuments()
	if err != nil {
		return "", err
	}
	wikiDocs := filterBySourceKind(docs, "wiki")
	sourceDocs := filterBySourceKind(docs, "source")

	sb.WriteString("## 概览\n\n")
	sb.WriteString(fmt.Sprintf("- Wiki 页面: %d\n", len(wikiDocs)))
	sb.WriteString(fmt.Sprintf("- 源文件: %d\n", len(sourceDocs)))

	// Tag distribution
	tagCount := make(map[string]int)
	for _, d := range wikiDocs {
		for _, t := range d.Tags {
			tagCount[t]++
		}
	}
	if len(tagCount) > 0 {
		sb.WriteString("\n### 标签分布\n\n")
		for _, t := range sortedKeys(tagCount) {
			sb.WriteString(fmt.Sprintf("- %s (%d)\n", t, tagCount[t]))
		}
	}

	// Content length analysis
	if focus == "all" || focus == "content" {
		shortPages := 0
		for _, d := range wikiDocs {
			if utf8.RuneCountInString(d.Content) < 200 {
				shortPages++
			}
		}
		if shortPages > 0 {
			sb.WriteString(fmt.Sprintf("\n### 内容问题\n\n- **内容过短** (< 200 字): %d 页\n", shortPages))
		}
	}

	// Ghost index entries (DB out of sync with filesystem)
	if workspace != "" && db != nil {
		adapter := storesvc.NewStoreAdapter(db)
		if ghostIssues, err := engine.LintGhostIndexEntries(workspace, adapter); err == nil && len(ghostIssues) > 0 {
			sb.WriteString(fmt.Sprintf("\n## 索引幽灵页 (%d)\n\n", len(ghostIssues)))
			for _, issue := range ghostIssues {
				sb.WriteString(fmt.Sprintf("- **%s** `%s` — %s\n", issue.Severity, issue.Path, issue.Message))
			}
		}
	}

	// Lint report (structure + links + metadata)
	if focus == "all" || focus == "structure" || focus == "links" || focus == "metadata" {
		if workspace != "" {
			report, err := engine.LintWorkspace(workspace)
			if err == nil && len(report.Issues) > 0 {
				errors, warnings := 0, 0
				for _, issue := range report.Issues {
					switch issue.Severity {
					case engine.LintSeverityError:
						errors++
					case engine.LintSeverityWarning:
						warnings++
					}
				}
				sb.WriteString(fmt.Sprintf("\n## Lint 检查 (%d 错误, %d 警告)\n\n", errors, warnings))

				// Filter by focus
				for _, issue := range report.Issues {
					if focus != "all" {
						switch focus {
						case "structure":
							if issue.Code != engine.LintCodeOrphanPage &&
								issue.Code != engine.LintCodeTypeDirMismatch &&
								issue.Code != engine.LintCodeMisplacedWikiPage &&
								issue.Code != engine.LintCodeEntityConceptCoupling &&
								issue.Code != engine.LintCodeDuplicatePage &&
								issue.Code != engine.LintCodeGhostIndexEntry {
								continue
							}
						case "links":
							if issue.Code != engine.LintCodeDeadLink {
								continue
							}
						case "metadata":
							if issue.Code != engine.LintCodeMissingFrontmatter {
								continue
							}
						}
					}
					sb.WriteString(fmt.Sprintf("- **%s** `%s` — %s\n", issue.Severity, issue.Path, issue.Message))
				}
			}
		}
	}

	// Uncited sources
	if focus == "all" || focus == "structure" {
		uncited := findUncitedSources(db, sourceDocs)
		if len(uncited) > 0 {
			sb.WriteString(fmt.Sprintf("\n## 未被引用的源文件 (%d)\n\n", len(uncited)))
			for _, d := range uncited {
				title := d.Title
				if title == "" {
					title = d.Filename
				}
				sb.WriteString(fmt.Sprintf("- %s — `%s`\n", title, d.RelativePath))
			}
		}
	}

	return sb.String(), nil
}

// --- structure implementation ---

func executeLocalStructure(workspace string, db *sqlite.DB, _ map[string]interface{}) (string, error) {
	if workspace == "" {
		return "Error: workspace not configured", nil
	}

	docs, err := db.ListDocuments()
	if err != nil {
		return "", err
	}
	wikiDocs := filterBySourceKind(docs, "wiki")
	contentCount := 0
	for _, d := range wikiDocs {
		if !engine.IsWikiSystemPath(d.RelativePath) {
			contentCount++
		}
	}

	// Build directory tree with counts
	dirPages := make(map[string][]sqlite.Document)
	for _, d := range wikiDocs {
		dir := filepath.Dir(d.RelativePath)
		dir = strings.TrimPrefix(dir, "wiki/")
		if dir == "wiki" || dir == "." {
			dir = ""
		}
		dirPages[dir] = append(dirPages[dir], d)
	}

	var sb strings.Builder
	sb.WriteString("# Wiki 目录结构\n\n")
	sb.WriteString(fmt.Sprintf("工作区：`%s`\n", workspace))
	sb.WriteString("数据来源：SQLite index（与文件系统不一致时请运行 `llmwiki reindex`，将自动清理幽灵索引）\n\n")
	sb.WriteString(fmt.Sprintf("总计 %d 个 wiki 文档（%d 个业务内容页）\n\n", len(wikiDocs), contentCount))

	reserved := []sqlite.Document{}
	misplaced := []sqlite.Document{}
	if rootPages, ok := dirPages[""]; ok {
		for _, d := range rootPages {
			switch engine.ClassifyWikiPath(d.RelativePath) {
			case engine.WikiPathReservedTopLevel:
				reserved = append(reserved, d)
			case engine.WikiPathMisplaced:
				misplaced = append(misplaced, d)
			default:
				reserved = append(reserved, d)
			}
		}
	}

	if len(reserved) > 0 {
		sb.WriteString("## 顶层系统页面\n\n")
		for _, d := range reserved {
			title := d.Title
			if title == "" {
				title = d.Filename
			}
			sb.WriteString(fmt.Sprintf("- %s (`%s`)\n", title, d.RelativePath))
		}
		sb.WriteString("\n")
	}

	if len(misplaced) > 0 {
		sb.WriteString(fmt.Sprintf("## 待整理页面 (%d)\n\n", len(misplaced)))
		for _, d := range misplaced {
			title := d.Title
			if title == "" {
				title = d.Filename
			}
			sb.WriteString(fmt.Sprintf("- %s — `%s`（应移入 typed 子目录）\n", title, d.RelativePath))
		}
		sb.WriteString("\n")
	}

	// Known typed directories
	shownDirs := make(map[string]bool)

	for _, dir := range engine.TypedWikiSubdirs {
		pages := dirPages[dir]
		shownDirs[dir] = true
		sb.WriteString(fmt.Sprintf("├── %s/ (%d 页)\n", dir, len(pages)))
		for i, d := range pages {
			title := d.Title
			if title == "" {
				title = d.Filename
			}
			prefix := "│   ├── "
			if i == len(pages)-1 {
				prefix = "│   └── "
			}
			tags := ""
			if len(d.Tags) > 0 {
				tags = fmt.Sprintf(" [%s]", strings.Join(d.Tags, ", "))
			}
			sb.WriteString(fmt.Sprintf("%s%s%s\n", prefix, title, tags))
		}
		if len(pages) == 0 {
			sb.WriteString("│   (空目录)\n")
		}
	}

	if templatePages := dirPages["templates"]; len(templatePages) > 0 {
		shownDirs["templates"] = true
		sb.WriteString(fmt.Sprintf("├── templates/ (%d 个系统模板)\n", len(templatePages)))
		for i, d := range templatePages {
			title := d.Title
			if title == "" {
				title = d.Filename
			}
			prefix := "│   ├── "
			if i == len(templatePages)-1 {
				prefix = "│   └── "
			}
			sb.WriteString(fmt.Sprintf("%s%s (系统模板)\n", prefix, title))
		}
	} else if templatesDirExists(workspace) {
		shownDirs["templates"] = true
		sb.WriteString("├── templates/ (0 个系统模板)\n")
		sb.WriteString("│   (空目录)\n")
	}

	// Other directories
	for dir, pages := range dirPages {
		if shownDirs[dir] || dir == "" {
			continue
		}
		sb.WriteString(fmt.Sprintf("├── %s/ (%d 页)\n", dir, len(pages)))
		for _, d := range pages {
			title := d.Title
			if title == "" {
				title = d.Filename
			}
			sb.WriteString(fmt.Sprintf("│   ├── %s\n", title))
		}
	}

	// Tag distribution
	tagCount := make(map[string]int)
	for _, d := range wikiDocs {
		for _, t := range d.Tags {
			tagCount[t]++
		}
	}
	if len(tagCount) > 0 {
		sb.WriteString("\n## 标签分布\n\n")
		for _, t := range sortedKeys(tagCount) {
			sb.WriteString(fmt.Sprintf("- %s (%d)\n", t, tagCount[t]))
		}
	}

	// Pages without tags
	noTags := 0
	for _, d := range wikiDocs {
		if len(d.Tags) == 0 {
			noTags++
		}
	}
	if noTags > 0 {
		sb.WriteString(fmt.Sprintf("\n%d 个页面没有标签\n", noTags))
	}

	return sb.String(), nil
}

// --- gaps implementation ---

func executeLocalGaps(workspace string, db *sqlite.DB, args map[string]interface{}) (string, error) {
	mode := "all"
	if m, ok := args["mode"].(string); ok && m != "" {
		mode = m
	}

	var sb strings.Builder

	if mode == "all" || mode == "dangling" {
		dangling := findDanglingLinks(workspace)
		sb.WriteString(fmt.Sprintf("## 缺失页面 (被引用但不存在) (%d)\n\n", len(dangling)))
		if len(dangling) > 0 {
			for _, d := range dangling {
				sb.WriteString(fmt.Sprintf("- [[%s]] — 被 %d 个页面引用\n", d.Target, d.RefCount))
			}
		} else {
			sb.WriteString("无缺失页面\n")
		}
	}

	if mode == "all" || mode == "uncited" {
		docs, err := db.ListDocuments()
		if err != nil {
			return "", err
		}
		sourceDocs := filterBySourceKind(docs, "source")
		uncited := findUncitedSources(db, sourceDocs)
		sb.WriteString(fmt.Sprintf("\n## 未被引用的源文件 (%d)\n\n", len(uncited)))
		if len(uncited) > 0 {
			for _, d := range uncited {
				title := d.Title
				if title == "" {
					title = d.Filename
				}
				sb.WriteString(fmt.Sprintf("- %s — `%s`\n", title, d.RelativePath))
			}
		} else {
			sb.WriteString("所有源文件都被 wiki 页面引用\n")
		}
	}

	return sb.String(), nil
}

type danglingLink struct {
	Target   string
	RefCount int
}

func findDanglingLinks(workspace string) []danglingLink {
	if workspace == "" {
		return nil
	}
	report, err := engine.LintWorkspace(workspace)
	if err != nil {
		return nil
	}
	// Collect dead link targets and count how many pages reference them
	linkCount := make(map[string]int)
	for _, issue := range report.Issues {
		if issue.Code == engine.LintCodeDeadLink {
			// Extract target from message like: 死链：目标不存在 "xxx"
			target := extractQuotedTarget(issue.Message)
			if target != "" {
				linkCount[target]++
			}
		}
	}
	var result []danglingLink
	for t, c := range linkCount {
		result = append(result, danglingLink{Target: t, RefCount: c})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].RefCount > result[j].RefCount })
	return result
}

func extractQuotedTarget(msg string) string {
	start := strings.Index(msg, `"`)
	if start < 0 {
		return ""
	}
	end := strings.Index(msg[start+1:], `"`)
	if end < 0 {
		return ""
	}
	return msg[start+1 : start+1+end]
}

func findUncitedSources(db *sqlite.DB, sourceDocs []sqlite.Document) []sqlite.Document {
	var uncited []sqlite.Document
	for _, d := range sourceDocs {
		bl, err := db.GetBacklinks(d.ID)
		if err == nil && len(bl) == 0 {
			uncited = append(uncited, d)
		}
	}
	return uncited
}

// --- similar implementation ---

type similarPair struct {
	PathA    string
	TitleA   string
	PathB    string
	TitleB   string
	Score    float64
}

func executeLocalSimilar(db *sqlite.DB, args map[string]interface{}) (string, error) {
	if db == nil {
		return "Error: database not connected", nil
	}
	specificPath, _ := args["path"].(string)
	limit := 50
	if l, ok := args["limit"].(float64); ok {
		limit = int(l)
	}

	docs, err := db.ListDocuments()
	if err != nil {
		return "", err
	}
	wikiDocs := filterBySourceKind(docs, "wiki")
	if len(wikiDocs) > limit {
		wikiDocs = wikiDocs[:limit]
	}

	var pairs []similarPair
	seen := make(map[string]bool)

	candidates := wikiDocs
	if specificPath != "" {
		candidates = nil
		for _, d := range wikiDocs {
			if d.RelativePath == specificPath || d.Filename == specificPath {
				candidates = []sqlite.Document{d}
				break
			}
		}
		if len(candidates) == 0 {
			return "Page not found: " + specificPath, nil
		}
	}

	for _, doc := range candidates {
		query := doc.Content
		if utf8.RuneCountInString(query) > 500 {
			query = string([]rune(query)[:500])
		}
		if strings.TrimSpace(query) == "" {
			continue
		}

		results, err := db.SearchChunks(query, 5, "wiki")
		if err != nil {
			continue
		}

		for _, r := range results {
			if r.Path == doc.RelativePath {
				continue
			}
			if r.Score < 0.3 {
				continue
			}

			// Dedup: use ordered pair key
			a, b := doc.RelativePath, r.Path
			if a > b {
				a, b = b, a
			}
			key := a + "|" + b
			if seen[key] {
				continue
			}
			seen[key] = true

			pairs = append(pairs, similarPair{
				PathA:  a,
				TitleA: pathToTitle(a, wikiDocs),
				PathB:  b,
				TitleB: pathToTitle(b, wikiDocs),
				Score:  r.Score,
			})
		}
	}

	sort.Slice(pairs, func(i, j int) bool { return pairs[i].Score > pairs[j].Score })

	var sb strings.Builder
	if len(pairs) == 0 {
		sb.WriteString("未发现明显的内容相似页面。\n")
		return sb.String(), nil
	}

	sb.WriteString(fmt.Sprintf("# 发现 %d 对可能相似的页面\n\n", len(pairs)))
	for i, p := range pairs {
		sb.WriteString(fmt.Sprintf("%d. **%s** (`%s`) ⟷ **%s** (`%s`)\n", i+1, p.TitleA, p.PathA, p.TitleB, p.PathB))
		sb.WriteString(fmt.Sprintf("   FTS 重叠度: %.2f — 建议检查是否需要合并或补充交叉链接\n\n", p.Score))
	}

	return sb.String(), nil
}

// --- helpers ---

func filterBySourceKind(docs []sqlite.Document, kind string) []sqlite.Document {
	var out []sqlite.Document
	for _, d := range docs {
		if d.SourceKind == kind {
			out = append(out, d)
		}
	}
	return out
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func pathToTitle(path string, docs []sqlite.Document) string {
	for _, d := range docs {
		if d.RelativePath == path {
			if d.Title != "" {
				return d.Title
			}
			return d.Filename
		}
	}
	return filepath.Base(path)
}

func templatesDirExists(workspace string) bool {
	info, err := os.Stat(filepath.Join(workspace, "wiki", "templates"))
	return err == nil && info.IsDir()
}

// ensure json import is used
var _ = json.Marshal
var _ = os.ReadFile
