package engine

import (
	"fmt"
	"regexp"
	"strings"
)

// logEntryRe matches: ## [YYYY-MM-DD] action | description
var logEntryRe = regexp.MustCompile(`^## \[(\d{4}-\d{2}-\d{2})\] .+ \| .+$`)

const logRelPath = "wiki/log.md"

// ValidateLogMD checks wiki/log.md entry format and date ordering.
func ValidateLogMD(content string) []LintIssue {
	var issues []LintIssue
	lines := strings.Split(content, "\n")

	var dates []string
	var dateLines []int

	for i, line := range lines {
		lineNum := i + 1
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "## [") {
			continue
		}
		if !logEntryRe.MatchString(trimmed) {
			issues = append(issues, LintIssue{
				Severity: LintSeverityError,
				Code:     LintCodeLogFormatInvalid,
				Path:     logRelPath,
				Line:     lineNum,
				Message:  fmt.Sprintf("日志条目格式无效，应为 ## [YYYY-MM-DD] action | description（第 %d 行）", lineNum),
			})
			continue
		}
		m := logEntryRe.FindStringSubmatch(trimmed)
		if len(m) >= 2 {
			dates = append(dates, m[1])
			dateLines = append(dateLines, lineNum)
		}
	}

	for i := 1; i < len(dates); i++ {
		if dates[i] < dates[i-1] {
			issues = append(issues, LintIssue{
				Severity: LintSeverityError,
				Code:     LintCodeLogDateDecreasing,
				Path:     logRelPath,
				Line:     dateLines[i],
				Message:  fmt.Sprintf("日志日期非递增：%s 早于前一条 %s", dates[i], dates[i-1]),
			})
		}
	}

	return issues
}
