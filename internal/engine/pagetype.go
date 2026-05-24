package engine

import "strings"

// WikiPageType returns the page type for a wiki relative path (e.g. wiki/entities/foo.md).
func WikiPageType(relPath string) string {
	relPath = normalizeWikiRelPath(relPath)
	if IsWikiSystemPath(relPath) {
		return "template"
	}
	subdir := WikiSubdirFromPath(relPath)
	if t, ok := WikiSubdirPageTypes[subdir]; ok && IsTypedContentWikiPage(relPath) {
		return t
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
