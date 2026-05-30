package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Lint severity levels.
const (
	LintSeverityError   = "error"
	LintSeverityWarning = "warning"
	LintSeverityInfo    = "info"
)

// Lint issue codes.
const (
	LintCodeDeadLink            = "dead_link"
	LintCodeOrphanPage          = "orphan_page"
	LintCodeMissingFrontmatter  = "missing_frontmatter"
	LintCodeTypeDirMismatch     = "type_dir_mismatch"
	LintCodeMisplacedWikiPage   = "misplaced_wiki_page"
	LintCodeLogFormatInvalid    = "log_format_invalid"
	LintCodeLogDateDecreasing   = "log_date_decreasing"
	LintCodeDuplicatePage       = "duplicate_page"
)

// LintIssue is a single wiki health check finding.
type LintIssue struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Path     string `json:"path"`
	Message  string `json:"message"`
	Line     int    `json:"line,omitempty"`
}

// LintStats summarizes wiki content metrics.
type LintStats struct {
	PageCount   int    `json:"page_count"`
	SourceCount int    `json:"source_count"`
	LastUpdated string `json:"last_updated,omitempty"`
}

// LintReport is the full lint result.
type LintReport struct {
	Issues    []LintIssue `json:"issues"`
	Stats     LintStats   `json:"stats"`
	CheckedAt time.Time   `json:"checked_at"`
}

var wikiDoubleBracketRe = regexp.MustCompile(`\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]`)

// LintWorkspace runs all mechanical wiki health checks on a workspace directory.
func LintWorkspace(workspace string) (*LintReport, error) {
	workspace, err := filepath.Abs(workspace)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace: %w", err)
	}

	report := &LintReport{
		Issues:    []LintIssue{},
		CheckedAt: time.Now().UTC(),
	}

	pages, err := collectWikiPages(workspace)
	if err != nil {
		return nil, err
	}

	pathIndex := buildWikiPathIndex(pages)
	incoming := make(map[string]int)
	pageContents := make(map[string]string, len(pages))

	for _, page := range pages {
		content, err := os.ReadFile(page.absPath)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", page.relPath, err)
		}
		text := string(content)
		pageContents[page.relPath] = text

		if page.inTypedSubdir {
			fm := ParseFrontmatter(text)
			report.Issues = append(report.Issues, ValidateFrontmatter(page.relPath, fm, page.subdir)...)
		}
		if page.isMisplaced {
			fm := ParseFrontmatter(text)
			report.Issues = append(report.Issues, LintIssue{
				Severity: LintSeverityWarning,
				Code:     LintCodeMisplacedWikiPage,
				Path:     page.relPath,
				Message:  MisplacedWikiPageMessage(page.relPath, fm.Type),
			})
		}

		targets := extractLinkTargets(text, page.relPath)
		for _, target := range targets {
			if !wikiTargetExists(pathIndex, target) {
				report.Issues = append(report.Issues, LintIssue{
					Severity: LintSeverityError,
					Code:     LintCodeDeadLink,
					Path:     page.relPath,
					Message:  fmt.Sprintf("死链：目标不存在 %q", target),
				})
			} else {
				resolved := resolveWikiTarget(pathIndex, target)
				if resolved != "" {
					incoming[resolved]++
				}
			}
		}
	}

	report.Issues = append(report.Issues, lintEntityConceptCoupling(pages, pageContents)...)
	report.Issues = append(report.Issues, lintDuplicatePages(pages)...)

	for _, page := range pages {
		if isOrphanExcluded(page.relPath) {
			continue
		}
		if incoming[page.relPath] == 0 {
			report.Issues = append(report.Issues, LintIssue{
				Severity: LintSeverityWarning,
				Code:     LintCodeOrphanPage,
				Path:     page.relPath,
				Message:  "孤立页面：无其他 wiki 页面链接到此页",
			})
		}
	}

	logPath := filepath.Join(workspace, "wiki", "log.md")
	if data, err := os.ReadFile(logPath); err == nil {
		report.Issues = append(report.Issues, ValidateLogMD(string(data))...)
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read log.md: %w", err)
	}

	report.Stats = computeLintStats(workspace, pages)
	return report, nil
}

// HasErrors returns true if the report contains any error-severity issues.
func (r *LintReport) HasErrors() bool {
	for _, issue := range r.Issues {
		if issue.Severity == LintSeverityError {
			return true
		}
	}
	return false
}

type wikiPage struct {
	relPath       string
	absPath       string
	subdir        string
	inTypedSubdir bool
	isSystem      bool
	isMisplaced   bool
}

func collectWikiPages(workspace string) ([]wikiPage, error) {
	wikiRoot := filepath.Join(workspace, "wiki")
	var pages []wikiPage

	err := filepath.Walk(wikiRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(info.Name()), ".md") {
			return nil
		}
		if info.Name() == ".gitkeep" {
			return nil
		}

		rel, err := filepath.Rel(workspace, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		subdir := WikiSubdirFromPath(rel)
		kind := ClassifyWikiPath(rel)
		pages = append(pages, wikiPage{
			relPath:       rel,
			absPath:       path,
			subdir:        subdir,
			inTypedSubdir: kind == WikiPathTypedContent,
			isSystem:      kind == WikiPathSystem,
			isMisplaced:   kind == WikiPathMisplaced,
		})
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("walk wiki: %w", err)
	}
	return pages, nil
}

func buildWikiPathIndex(pages []wikiPage) map[string]struct{} {
	index := make(map[string]struct{})
	for _, p := range pages {
		index[strings.ToLower(p.relPath)] = struct{}{}
		// slug without extension
		stem := strings.TrimSuffix(strings.ToLower(filepath.Base(p.relPath)), ".md")
		dir := filepath.ToSlash(filepath.Dir(p.relPath))
		if dir != "." {
			index[strings.ToLower(dir+"/"+stem)] = struct{}{}
		}
		index[strings.ToLower(stem)] = struct{}{}
	}
	return index
}

func extractLinkTargets(content, sourceRelPath string) []string {
	var targets []string
	seen := make(map[string]struct{})

	add := func(t string) {
		t = strings.TrimSpace(t)
		if t == "" {
			return
		}
		if _, ok := seen[t]; ok {
			return
		}
		seen[t] = struct{}{}
		targets = append(targets, t)
	}

	for _, m := range wikiDoubleBracketRe.FindAllStringSubmatch(content, -1) {
		if len(m) >= 2 {
			add(m[1])
		}
	}

	wikiRel := wikiRelDir(sourceRelPath)
	for _, m := range wikiLinkRe.FindAllStringSubmatch(content, -1) {
		if len(m) < 4 || m[1] == "!" {
			continue
		}
		href := m[3]
		if isExternalOrAssetLink(href) {
			continue
		}
		add(resolveHrefToWikiTarget(href, wikiRel))
	}

	return targets
}

func wikiRelDir(relPath string) string {
	relPath = filepath.ToSlash(relPath)
	if !strings.HasPrefix(relPath, "wiki/") {
		return ""
	}
	dir := filepath.Dir(relPath)
	if dir == "wiki" {
		return ""
	}
	return strings.TrimPrefix(dir, "wiki/") + "/"
}

func resolveHrefToWikiTarget(href, wikiRel string) string {
	href = strings.TrimSpace(href)
	if href == "" {
		return ""
	}
	if strings.HasPrefix(href, "/wiki/") {
		return strings.TrimPrefix(href, "/wiki/")
	}
	if strings.HasPrefix(href, "wiki/") {
		return strings.TrimPrefix(href, "wiki/")
	}
	if strings.HasPrefix(href, "./") {
		return normalizeWikiPath(wikiRel + href[2:])
	}
	if strings.HasPrefix(href, "../") {
		return normalizeWikiPath(wikiRel + href)
	}
	if !strings.Contains(href, "/") {
		return normalizeWikiPath(wikiRel + href)
	}
	return normalizeWikiPath(href)
}

func normalizeWikiPath(p string) string {
	parts := strings.Split(p, "/")
	var clean []string
	for _, part := range parts {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(clean) > 0 {
				clean = clean[:len(clean)-1]
			}
		default:
			clean = append(clean, part)
		}
	}
	return strings.Join(clean, "/")
}

func wikiTargetExists(index map[string]struct{}, target string) bool {
	return resolveWikiTarget(index, target) != ""
}

func resolveWikiTarget(index map[string]struct{}, target string) string {
	target = strings.Trim(strings.TrimSpace(target), "/")
	if target == "" {
		return ""
	}
	lower := strings.ToLower(target)

	candidates := []string{
		"wiki/" + lower,
		"wiki/" + lower + ".md",
	}
	if strings.HasPrefix(lower, "wiki/") {
		candidates = append(candidates, lower, lower+".md")
	} else {
		candidates = append(candidates, lower, lower+".md")
	}

	for _, c := range candidates {
		if _, ok := index[c]; ok {
			return c
		}
	}
	return ""
}

func isExternalOrAssetLink(href string) bool {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") ||
		strings.HasPrefix(href, "#") || strings.HasPrefix(href, "mailto:") {
		return true
	}
	lower := strings.ToLower(href)
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

func isOrphanExcluded(relPath string) bool {
	relPath = filepath.ToSlash(relPath)
	if IsWikiSystemPath(relPath) {
		return true
	}
	switch relPath {
	case "wiki/index.md", "wiki/log.md", "wiki/overview.md":
		return true
	}
	// Exclude first-level files in wiki/sources/
	if strings.HasPrefix(relPath, "wiki/sources/") {
		rest := strings.TrimPrefix(relPath, "wiki/sources/")
		if !strings.Contains(rest, "/") {
			return true
		}
	}
	return false
}

func lintDuplicatePages(pages []wikiPage) []LintIssue {
	groups := make(map[string][]wikiPage)
	for _, page := range pages {
		if !page.inTypedSubdir || page.isSystem {
			continue
		}
		groups[page.subdir] = append(groups[page.subdir], page)
	}

	var issues []LintIssue
	for _, group := range groups {
		normalized := make(map[string][]string)
		for _, page := range group {
			stem := strings.TrimSuffix(filepath.Base(page.relPath), filepath.Ext(page.relPath))
			key := normalizeNameKey(stem)
			normalized[key] = append(normalized[key], page.relPath)
		}
		for _, paths := range normalized {
			if len(paths) < 2 {
				continue
			}
			for _, p := range paths {
				issues = append(issues, LintIssue{
					Severity: LintSeverityWarning,
					Code:     LintCodeDuplicatePage,
					Path:     p,
					Message:  fmt.Sprintf("疑似重复页面：同目录下存在归一化文件名相同的页面 %v", paths),
				})
			}
		}
	}
	return issues
}

func computeLintStats(workspace string, pages []wikiPage) LintStats {
	stats := LintStats{}
	for _, page := range pages {
		if page.isSystem {
			continue
		}
		stats.PageCount++
	}

	sourcesDir := filepath.Join(workspace, "raw", "sources")
	entries, err := os.ReadDir(sourcesDir)
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() && e.Name() != ".gitkeep" {
				stats.SourceCount++
			}
		}
	}

	var lastDate string
	for _, page := range pages {
		data, err := os.ReadFile(page.absPath)
		if err != nil {
			continue
		}
		fm := ParseFrontmatter(string(data))
		if d := fm.GetDate(); d != "" && (lastDate == "" || d > lastDate) {
			lastDate = d
		}
	}
	stats.LastUpdated = lastDate
	return stats
}
