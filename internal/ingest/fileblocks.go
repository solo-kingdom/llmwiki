package ingest

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/engine"
)

var fileBlockRe = regexp.MustCompile(`(?s)---FILE:\s*(.+?)\n(.*?)---END FILE---`)

// errNoWikiFilesWritten is returned when FILE blocks were parsed but no wiki files were written.
var errNoWikiFilesWritten = errors.New("no wiki files written from FILE blocks")

func parseFileBlocks(output string) []string {
	matches := fileBlockRe.FindAllStringSubmatch(output, -1)
	var files []string
	for _, m := range matches {
		path := strings.TrimSpace(m[1])
		if path != "" {
			files = append(files, path)
		}
	}
	return files
}

// parseFileBlocksWithContent parses FILE blocks and returns path->content map.
func parseFileBlocksWithContent(output string) map[string]string {
	result := make(map[string]string)
	matches := fileBlockRe.FindAllStringSubmatch(output, -1)
	for _, m := range matches {
		path := strings.TrimSpace(m[1])
		content := m[2]
		if path != "" {
			result[path] = content
		}
	}
	return result
}

// NormalizeWikiFilePath maps LLM shorthand paths to typed wiki locations under wiki/.
func NormalizeWikiFilePath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("empty FILE path")
	}
	if strings.HasPrefix(path, "wiki/") {
		return path, nil
	}
	type prefixMap struct {
		prefix string
		target string
	}
	mappings := []prefixMap{
		{"entities/", "wiki/entities/"},
		{"entity/", "wiki/entities/"},
		{"concepts/", "wiki/concepts/"},
		{"concept/", "wiki/concepts/"},
		{"sources/", "wiki/sources/"},
		{"source/", "wiki/sources/"},
		{"synthesis/", "wiki/synthesis/"},
		{"comparisons/", "wiki/comparisons/"},
		{"comparison/", "wiki/comparisons/"},
		{"queries/", "wiki/queries/"},
		{"query/", "wiki/queries/"},
	}
	for _, m := range mappings {
		if strings.HasPrefix(path, m.prefix) {
			return m.target + strings.TrimPrefix(path, m.prefix), nil
		}
	}
	return "", fmt.Errorf("unrecognized wiki FILE path prefix: %s", path)
}

// normalizeWikiFileBlocks normalizes all paths; returns adjustment descriptions (original -> normalized).
func normalizeWikiFileBlocks(blocks map[string]string) (map[string]string, []string, error) {
	if len(blocks) == 0 {
		return blocks, nil, nil
	}
	out := make(map[string]string, len(blocks))
	var adjustments []string
	for path, content := range blocks {
		norm, err := NormalizeWikiFilePath(path)
		if err != nil {
			return nil, nil, err
		}
		if norm != path {
			adjustments = append(adjustments, path+" -> "+norm)
		}
		out[norm] = content
	}
	return out, adjustments, nil
}

// ApplyWikiResult holds paths touched by ApplyWikiBlocks.
type ApplyWikiResult struct {
	Written []string
	Deleted []string
}

// ApplyWikiBlocks writes or deletes wiki files under workspace from LLM FILE blocks.
// When opts.Merge is set and ForceOverwrite is false, existing pages are merged instead of overwritten.
func ApplyWikiBlocks(ctx context.Context, workspace string, blocks map[string]string, opts *ApplyWikiBlocksOpts) (ApplyWikiResult, error) {
	rawCount := len(blocks)
	blocks, adjustments, err := normalizeWikiFileBlocks(blocks)
	if err != nil {
		return ApplyWikiResult{}, err
	}
	if len(adjustments) > 0 {
		log.Printf("ApplyWikiBlocks: normalized paths: %s", strings.Join(adjustments, ", "))
	}

	var result ApplyWikiResult
	var handled int
	for path, content := range blocks {
		fullPath := filepath.Join(workspace, path)

		if content == "---DELETE---\n" {
			if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
				log.Printf("ApplyWikiBlocks: failed to delete %s: %v", path, err)
			} else {
				result.Deleted = append(result.Deleted, path)
			}
			continue
		}

		if err := engine.ValidateWikiWritePath(path); err != nil {
			return ApplyWikiResult{}, err
		}

		writeContent := content
		if opts != nil && opts.Merge != nil && !opts.ForceOverwrite {
			merged, skip, err := MergeWikiPage(ctx, fullPath, content, opts.Merge)
			if err != nil {
				return ApplyWikiResult{}, fmt.Errorf("merge %s: %w", path, err)
			}
			if skip {
				handled++
				continue
			}
			writeContent = merged
		}

		dir := filepath.Dir(fullPath)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return ApplyWikiResult{}, fmt.Errorf("create dir %s: %w", dir, err)
		}
		if err := os.WriteFile(fullPath, []byte(writeContent), 0o644); err != nil {
			return ApplyWikiResult{}, fmt.Errorf("write %s: %w", path, err)
		}
		result.Written = append(result.Written, path)
		handled++
	}

	// Fail when blocks were present but nothing was applied (not even unchanged merge skips).
	if rawCount > 0 && len(result.Written) == 0 && len(result.Deleted) == 0 && handled == 0 {
		return ApplyWikiResult{}, errNoWikiFilesWritten
	}
	return result, nil
}
