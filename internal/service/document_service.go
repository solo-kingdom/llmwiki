// Package service provides business logic for document operations.
package service

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

// DocumentService handles document CRUD operations with filesystem + DB synchronization.
type DocumentService struct {
	Workspace string // workspace root directory
}

// NewDocumentService creates a new document service.
func NewDocumentService(workspace string) *DocumentService {
	return &DocumentService{Workspace: workspace}
}

// nonAlphaNum is used for slugification
var nonAlphaNumRe = regexp.MustCompile(`[^a-z0-9\s-]`)
var whitespaceRe = regexp.MustCompile(`[\s-]+`)

// SlugifyTitle converts a title to a safe filename.
func SlugifyTitle(title string) string {
	slug := strings.ToLower(strings.TrimSpace(title))
	slug = nonAlphaNumRe.ReplaceAllString(slug, "")
	slug = whitespaceRe.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "untitled"
	}
	return slug
}

// FilenameFromTitle returns a markdown filename from a title.
func FilenameFromTitle(title string) string {
	return SlugifyTitle(title) + ".md"
}

// ResolvePath resolves a user-provided path to dir_path and filename.
func ResolvePath(inputPath string) (dirPath, filename string) {
	// Default to wiki/
	if inputPath == "" || inputPath == "/" {
		return "/wiki/", ""
	}

	// Normalize: ensure leading /
	if !strings.HasPrefix(inputPath, "/") {
		inputPath = "/" + inputPath
	}

	// Ensure trailing / for directories
	if !strings.HasSuffix(inputPath, "/") && !strings.Contains(filepath.Ext(inputPath), ".") {
		inputPath += "/"
	}

	dir := filepath.Dir(inputPath)
	if !strings.HasSuffix(dir, "/") {
		dir += "/"
	}
	base := filepath.Base(inputPath)

	if base == "." || base == "/" {
		return dir, ""
	}

	return dir, base
}

// IsProtectedFile returns true if the file should not be deleted.
func IsProtectedFile(dirPath, filename string) bool {
	return (dirPath == "/wiki/" && (filename == "overview.md" || filename == "log.md"))
}

// ValidatePath checks for path traversal and other security issues.
func ValidatePath(path string) error {
	// Reject absolute paths
	if filepath.IsAbs(path) {
		return fmt.Errorf("absolute paths are not allowed")
	}
	// Reject path traversal
	clean := filepath.Clean(path)
	if strings.Contains(clean, "..") {
		return fmt.Errorf("path traversal detected")
	}
	return nil
}

// ParseFrontmatter is a convenience wrapper.
var ParseFrontmatter = engine.ParseFrontmatter

// TitleFromFilename is a convenience wrapper.
var TitleFromFilename = engine.TitleFromFilename
