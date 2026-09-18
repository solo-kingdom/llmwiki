package acp

import "regexp"

var sanitizePatterns = []*regexp.Regexp{
	regexp.MustCompile(`sk-[A-Za-z0-9_\-]{8,}`),
	regexp.MustCompile(`(?i)bearer\s+\S+`),
	regexp.MustCompile(`gh[pousr]_[A-Za-z0-9]{16,}`),
	regexp.MustCompile(`xox[baprs]-\S+`),
}

// SanitizeText masks common credential shapes before diagnostics are persisted.
func SanitizeText(s string) string {
	for _, re := range sanitizePatterns {
		s = re.ReplaceAllString(s, "***")
	}
	return s
}
