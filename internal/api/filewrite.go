package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// writeFileFirst writes content to the filesystem BEFORE updating the DB index.
// This enforces the file-first write ordering required by the truth-data-persistence-boundary spec.
// canonicalPath is a relative path like "wiki/concepts/attention.md".
func (a *API) writeFileFirst(canonicalPath, content string) error {
	return a.writeFileBytesFirst(canonicalPath, []byte(content))
}

// writeFileBytesFirst writes raw bytes to the filesystem BEFORE updating DB/index state.
func (a *API) writeFileBytesFirst(canonicalPath string, content []byte) error {
	if a.workspace == "" {
		// If no workspace is configured (e.g., in tests), skip file write
		return nil
	}

	// Normalize: strip leading slash
	relPath := strings.TrimPrefix(canonicalPath, "/")

	fullPath := filepath.Join(a.workspace, relPath)

	// Ensure directory exists
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}

	// Write atomically: write to temp file then rename
	tmpFile, err := os.CreateTemp(dir, ".llmwiki-write-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(content); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write temp file: %w", err)
	}
	tmpFile.Close()

	// Atomic rename
	if err := os.Rename(tmpPath, fullPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename temp to target: %w", err)
	}

	return nil
}

// resolveCanonicalPath builds the canonical file path from document metadata.
func resolveCanonicalPath(relativePath string) string {
	return strings.TrimPrefix(relativePath, "/")
}
