package engine

import (
	"fmt"
	"path/filepath"
	"strings"
)

// WikiSubdirPageTypes maps wiki/ subdirectory names to page type identifiers.
var WikiSubdirPageTypes = map[string]string{
	"entities":    "entity",
	"concepts":    "concept",
	"sources":     "source",
	"synthesis":   "synthesis",
	"comparisons": "comparison",
	"queries":     "query",
}

// PageTypeToWikiSubdir maps frontmatter page types to wiki subdirectory names.
var PageTypeToWikiSubdir = map[string]string{
	"entity":     "entities",
	"concept":    "concepts",
	"source":     "sources",
	"synthesis":  "synthesis",
	"comparison": "comparisons",
	"query":      "queries",
}

// ReservedTopLevelWikiPages are the only top-level wiki markdown pages allowed by default.
var ReservedTopLevelWikiPages = map[string]struct{}{
	"wiki/overview.md": {},
	"wiki/index.md":    {},
	"wiki/log.md":      {},
}

// WikiSystemSubdirs are wiki subdirectories for system scaffolds, not business content.
var WikiSystemSubdirs = map[string]struct{}{
	"templates": {},
}

// TypedWikiSubdirs lists business content subdirectories in stable order.
var TypedWikiSubdirs = []string{
	"entities",
	"concepts",
	"sources",
	"synthesis",
	"comparisons",
	"queries",
}

// WikiPathKind classifies a workspace-relative wiki path.
type WikiPathKind int

const (
	WikiPathOther WikiPathKind = iota
	WikiPathReservedTopLevel
	WikiPathTypedContent
	WikiPathSystem
	WikiPathMisplaced
)

// ClassifyWikiPath returns the organization kind for a workspace-relative path.
func ClassifyWikiPath(relPath string) WikiPathKind {
	relPath = normalizeWikiRelPath(relPath)
	if relPath == "" || !strings.HasPrefix(relPath, "wiki/") {
		return WikiPathOther
	}
	if _, ok := ReservedTopLevelWikiPages[relPath]; ok {
		return WikiPathReservedTopLevel
	}
	parts := strings.Split(strings.TrimPrefix(relPath, "wiki/"), "/")
	if len(parts) == 0 {
		return WikiPathOther
	}
	if len(parts) >= 1 {
		if _, ok := WikiSystemSubdirs[parts[0]]; ok {
			return WikiPathSystem
		}
	}
	if len(parts) == 2 && strings.HasSuffix(strings.ToLower(parts[1]), ".md") {
		if _, ok := WikiSubdirPageTypes[parts[0]]; ok {
			return WikiPathTypedContent
		}
	}
	if len(parts) == 1 && strings.HasSuffix(strings.ToLower(parts[0]), ".md") {
		return WikiPathMisplaced
	}
	return WikiPathOther
}

func normalizeWikiRelPath(relPath string) string {
	relPath = strings.TrimSpace(relPath)
	relPath = strings.TrimPrefix(relPath, "/")
	return filepath.ToSlash(relPath)
}

// IsReservedTopLevelWikiPage reports whether relPath is a reserved top-level wiki page.
func IsReservedTopLevelWikiPage(relPath string) bool {
	return ClassifyWikiPath(relPath) == WikiPathReservedTopLevel
}

// IsWikiSystemPath reports whether relPath is under a system wiki subdirectory such as templates/.
func IsWikiSystemPath(relPath string) bool {
	return ClassifyWikiPath(relPath) == WikiPathSystem
}

// IsTypedContentWikiPage reports whether relPath is a business page under a typed wiki subdirectory.
func IsTypedContentWikiPage(relPath string) bool {
	return ClassifyWikiPath(relPath) == WikiPathTypedContent
}

// IsMisplacedWikiPage reports whether relPath is a top-level business wiki page.
func IsMisplacedWikiPage(relPath string) bool {
	return ClassifyWikiPath(relPath) == WikiPathMisplaced
}

// WikiSubdirFromPath returns the first subdirectory under wiki/ when present.
func WikiSubdirFromPath(relPath string) string {
	relPath = normalizeWikiRelPath(relPath)
	if !strings.HasPrefix(relPath, "wiki/") {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(relPath, "wiki/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return ""
	}
	return parts[0]
}

// SuggestedWikiSubdirForPageType returns the typed subdirectory for a frontmatter page type.
func SuggestedWikiSubdirForPageType(pageType string) string {
	return PageTypeToWikiSubdir[strings.TrimSpace(pageType)]
}

// AllowedTypedWikiDirsMessage returns a human-readable list of allowed typed wiki directories.
func AllowedTypedWikiDirsMessage() string {
	dirs := make([]string, 0, len(TypedWikiSubdirs))
	for _, d := range TypedWikiSubdirs {
		dirs = append(dirs, "wiki/"+d+"/")
	}
	return strings.Join(dirs, ", ")
}

// ValidateWikiWritePath checks whether a wiki FILE block path may be written by ingest.
func ValidateWikiWritePath(relPath string) error {
	relPath = normalizeWikiRelPath(relPath)
	if !strings.HasPrefix(relPath, "wiki/") {
		return fmt.Errorf("path must be under wiki/: %s", relPath)
	}
	switch ClassifyWikiPath(relPath) {
	case WikiPathSystem:
		return fmt.Errorf("cannot write to system template path: %s", relPath)
	case WikiPathMisplaced:
		return fmt.Errorf("misplaced business page %s: business pages must be under %s", relPath, AllowedTypedWikiDirsMessage())
	case WikiPathOther:
		return fmt.Errorf("unsupported wiki path: %s", relPath)
	default:
		return nil
	}
}

// MisplacedWikiPageMessage builds a lint/diagnostic message for a misplaced page.
func MisplacedWikiPageMessage(relPath string, pageType string) string {
	msg := "业务页面不应位于 wiki/ 顶层，应放入类型子目录"
	if subdir := SuggestedWikiSubdirForPageType(pageType); subdir != "" {
		msg += fmt.Sprintf("；建议目录：wiki/%s/", subdir)
	}
	return msg
}
