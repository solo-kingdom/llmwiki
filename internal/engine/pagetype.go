package engine

import "strings"

// WikiSubdirPageTypes maps wiki/ subdirectory names to page type identifiers.
var WikiSubdirPageTypes = map[string]string{
	"entities":    "entity",
	"concepts":    "concept",
	"sources":     "source",
	"synthesis":   "synthesis",
	"comparisons": "comparison",
	"queries":     "query",
}

// WikiPageType returns the page type for a wiki relative path (e.g. wiki/entities/foo.md).
func WikiPageType(relPath string) string {
	parts := strings.Split(strings.Trim(relPath, "/"), "/")
	if len(parts) >= 2 {
		if t, ok := WikiSubdirPageTypes[parts[1]]; ok {
			return t
		}
	}
	return "page"
}

// WikiPageTypeFromPaths resolves page type from relative_path or absolute-style path.
func WikiPageTypeFromPaths(relativePath, path string) string {
	if relativePath != "" {
		return WikiPageType(relativePath)
	}
	return WikiPageType(strings.TrimPrefix(path, "/"))
}
