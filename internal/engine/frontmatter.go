package engine

import (
	"fmt"
	"regexp"

	"gopkg.in/yaml.v3"
)

// Frontmatter holds YAML metadata extracted from markdown pages.
type Frontmatter struct {
	Title       string   `yaml:"title"`
	Description string   `yaml:"description"`
	Date        string   `yaml:"date"`
	Type        string   `yaml:"type"`
	Tags        []string `yaml:"tags"`
}

// ValidateFrontmatter checks required fields and type↔directory consistency.
func ValidateFrontmatter(relPath string, fm Frontmatter, subdir string) []LintIssue {
	var issues []LintIssue

	if fm.Title == "" {
		issues = append(issues, LintIssue{
			Severity: LintSeverityError,
			Code:     LintCodeMissingFrontmatter,
			Path:     relPath,
			Message:  "缺少必需 frontmatter 字段：title",
		})
	}
	if fm.GetDate() == "" {
		issues = append(issues, LintIssue{
			Severity: LintSeverityError,
			Code:     LintCodeMissingFrontmatter,
			Path:     relPath,
			Message:  "缺少必需 frontmatter 字段：date",
		})
	}
	if fm.Type == "" {
		issues = append(issues, LintIssue{
			Severity: LintSeverityError,
			Code:     LintCodeMissingFrontmatter,
			Path:     relPath,
			Message:  "缺少必需 frontmatter 字段：type",
		})
		return issues
	}

	expected, ok := dirToPageType[subdir]
	if !ok {
		return issues
	}
	if fm.Type != expected {
		issues = append(issues, LintIssue{
			Severity: LintSeverityError,
			Code:     LintCodeTypeDirMismatch,
			Path:     relPath,
			Message:  fmt.Sprintf("type 与目录不匹配：目录 %s/ 应为 type: %s，实际为 %s", subdir, expected, fm.Type),
		})
	}
	return issues
}

// frontmatterRegex matches YAML frontmatter delimited by ---.
var frontmatterRegex = regexp.MustCompile(`(?s)\A---[ \t]*\n(.+?\n)---[ \t]*\n`)

// ParseFrontmatter extracts YAML frontmatter from markdown content.
// Returns empty Frontmatter if no frontmatter is found.
func ParseFrontmatter(content string) Frontmatter {
	m := frontmatterRegex.FindStringSubmatch(content)
	if len(m) < 2 {
		return Frontmatter{}
	}

	var fm Frontmatter
	if err := yaml.Unmarshal([]byte(m[1]), &fm); err != nil {
		return Frontmatter{}
	}

	// Normalize tags to []string
	if fm.Tags == nil {
		fm.Tags = []string{}
	}
	return fm
}

// ExtractDate converts a frontmatter date field to a string.
// Handles both string dates and yaml date objects.
func (fm Frontmatter) GetDate() string {
	return fm.Date
}

// GetTagsString returns tags as a JSON array string suitable for SQLite storage.
func (fm Frontmatter) GetTagsString() string {
	if len(fm.Tags) == 0 {
		return "[]"
	}
	// Simple JSON encoding for string array
	result := "["
	for i, t := range fm.Tags {
		if i > 0 {
			result += ","
		}
		result += `"` + t + `"`
	}
	result += "]"
	return result
}

// GetMetadataJSON returns metadata as a JSON object string.
func (fm Frontmatter) GetMetadataJSON() string {
	if fm.Description == "" {
		return "{}"
	}
	return `{"description":"` + fm.Description + `"}`
}

// TitleFromFilename derives a display title from a filename.
func TitleFromFilename(filename string) string {
	// Remove extension
	stem := filename
	for i := len(stem) - 1; i >= 0; i-- {
		if stem[i] == '.' {
			stem = stem[:i]
			break
		}
	}
	// Replace separators with spaces and title-case
	result := make([]rune, 0, len(stem))
	capitalize := true
	for _, r := range stem {
		if r == '-' || r == '_' {
			result = append(result, ' ')
			capitalize = true
		} else if capitalize {
			if r >= 'a' && r <= 'z' {
				result = append(result, r-32)
			} else {
				result = append(result, r)
			}
			capitalize = false
		} else {
			result = append(result, r)
		}
	}
	return string(result)
}
