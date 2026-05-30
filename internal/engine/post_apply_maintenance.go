package engine

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// WikiFileIndexer indexes or removes workspace-relative paths after maintenance writes.
type WikiFileIndexer interface {
	IndexFile(relPath string) error
}

// PostApplyMaintenanceOpts configures post-apply wiki maintenance.
type PostApplyMaintenanceOpts struct {
	WrittenPaths []string
	DeletedPaths []string
	SessionMode  string
	PlanSummary  string
	MoveCount    int
	MergeCount   int
	Indexer      WikiFileIndexer
}

// PostApplyMaintenanceResult reports what maintenance did.
type PostApplyMaintenanceResult struct {
	IndexRebuilt bool
	LogAppended  bool
	Warning      string
}

// PostApplyMaintenance rebuilds wiki/index.md and optionally appends organize log entries
// after a successful wiki apply. Errors are returned as warnings; callers should not fail apply.
func PostApplyMaintenance(workspace string, opts PostApplyMaintenanceOpts) PostApplyMaintenanceResult {
	var result PostApplyMaintenanceResult
	if workspace == "" {
		return result
	}
	if !wikiApplyChanged(opts.WrittenPaths, opts.DeletedPaths) {
		return result
	}

	ib := NewIndexBuilder(workspace)
	if err := ib.RebuildIndex(); err != nil {
		result.Warning = fmt.Sprintf("rebuild index: %v", err)
		log.Printf("PostApplyMaintenance: %s", result.Warning)
		return result
	}
	result.IndexRebuilt = true

	if opts.Indexer != nil {
		if err := opts.Indexer.IndexFile(indexRelPath); err != nil {
			log.Printf("PostApplyMaintenance: index %s: %v", indexRelPath, err)
		}
	}

	if shouldAppendOrganizeLog(opts) {
		entry := buildOrganizeLogEntry(opts)
		if err := appendWikiLogEntry(workspace, entry); err != nil {
			w := fmt.Sprintf("append log: %v", err)
			if result.Warning != "" {
				result.Warning += "; " + w
			} else {
				result.Warning = w
			}
			log.Printf("PostApplyMaintenance: %s", w)
		} else {
			result.LogAppended = true
			if opts.Indexer != nil {
				if err := opts.Indexer.IndexFile(logRelPath); err != nil {
					log.Printf("PostApplyMaintenance: index %s: %v", logRelPath, err)
				}
			}
		}
	}

	return result
}

func wikiApplyChanged(written, deleted []string) bool {
	return len(written) > 0 || len(deleted) > 0
}

func shouldAppendOrganizeLog(opts PostApplyMaintenanceOpts) bool {
	if opts.SessionMode != "organize" {
		return false
	}
	return opts.MoveCount > 0 || opts.MergeCount > 0
}

func buildOrganizeLogEntry(opts PostApplyMaintenanceOpts) string {
	date := time.Now().Format("2006-01-02")
	var parts []string
	if opts.MoveCount > 0 {
		parts = append(parts, fmt.Sprintf("移动 %d 页", opts.MoveCount))
	}
	if opts.MergeCount > 0 {
		parts = append(parts, fmt.Sprintf("合并 %d 组", opts.MergeCount))
	}
	summary := strings.Join(parts, "，")
	if s := strings.TrimSpace(opts.PlanSummary); s != "" {
		if len([]rune(s)) > 120 {
			s = string([]rune(s)[:120]) + "…"
		}
		summary = summary + "：" + s
	}
	return fmt.Sprintf("## [%s] organize | %s\n", date, summary)
}

func appendWikiLogEntry(workspace, entry string) error {
	path := filepath.Join(workspace, logRelPath)
	existing, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	var sb strings.Builder
	if len(existing) > 0 {
		sb.Write(existing)
		if !strings.HasSuffix(string(existing), "\n") {
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}
	sb.WriteString(entry)
	if !strings.HasSuffix(entry, "\n") {
		sb.WriteString("\n")
	}
	return os.WriteFile(path, []byte(sb.String()), 0o644)
}
