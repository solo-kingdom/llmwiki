package ingest

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var fileBlockRe = regexp.MustCompile(`(?s)---FILE:\s*(.+?)\n(.*?)---END FILE---`)

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

// ApplyWikiBlocks writes or deletes wiki files under workspace from LLM FILE blocks.
// When opts.Merge is set and ForceOverwrite is false, existing pages are merged instead of overwritten.
// Returns relative paths that were written (not deleted or skipped as unchanged).
func ApplyWikiBlocks(ctx context.Context, workspace string, blocks map[string]string, opts *ApplyWikiBlocksOpts) ([]string, error) {
	var written []string
	for path, content := range blocks {
		if !strings.HasPrefix(path, "wiki/") {
			log.Printf("ApplyWikiBlocks: skipping non-wiki path: %s", path)
			continue
		}

		fullPath := filepath.Join(workspace, path)

		if content == "---DELETE---\n" {
			if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
				log.Printf("ApplyWikiBlocks: failed to delete %s: %v", path, err)
			}
			continue
		}

		writeContent := content
		if opts != nil && opts.Merge != nil && !opts.ForceOverwrite {
			merged, skip, err := MergeWikiPage(ctx, fullPath, content, opts.Merge)
			if err != nil {
				return nil, fmt.Errorf("merge %s: %w", path, err)
			}
			if skip {
				continue
			}
			writeContent = merged
		}

		dir := filepath.Dir(fullPath)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create dir %s: %w", dir, err)
		}
		if err := os.WriteFile(fullPath, []byte(writeContent), 0o644); err != nil {
			return nil, fmt.Errorf("write %s: %w", path, err)
		}
		written = append(written, path)
	}
	return written, nil
}
