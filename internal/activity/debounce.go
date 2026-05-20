package activity

import (
	"fmt"
	"sync"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const watcherDebounce = 700 * time.Millisecond

var (
	debounceMu sync.Mutex
	pending    = make(map[string]*time.Timer)
)

// RecordWatcherModify debounces modify events per relative path (700ms).
func RecordWatcherModify(db *sqlite.DB, relPath string) {
	if db == nil || relPath == "" {
		return
	}
	debounceMu.Lock()
	defer debounceMu.Unlock()
	if t, ok := pending[relPath]; ok {
		t.Stop()
	}
	pending[relPath] = time.AfterFunc(watcherDebounce, func() {
		debounceMu.Lock()
		delete(pending, relPath)
		debounceMu.Unlock()
		Record(db, Entry{
			Level:    "info",
			Category: "watcher",
			Action:   "file_modified",
			Message:  fmt.Sprintf("文件已修改：%s", relPath),
			ResourceType: "file",
			ResourceID:   relPath,
			Status:       "success",
			Source:       "watcher",
			Details: map[string]interface{}{
				"path": relPath,
			},
		})
	})
}

// RecordWatcherEvent logs immediate watcher create/delete events.
func RecordWatcherEvent(db *sqlite.DB, action, relPath string) {
	if db == nil || relPath == "" {
		return
	}
	msg := fmt.Sprintf("文件已变更：%s", relPath)
	switch action {
	case "file_created":
		msg = fmt.Sprintf("文件已创建：%s", relPath)
	case "file_deleted":
		msg = fmt.Sprintf("文件已删除：%s", relPath)
	}
	Record(db, Entry{
		Level:        "info",
		Category:     "watcher",
		Action:       action,
		Message:      msg,
		ResourceType: "file",
		ResourceID:   relPath,
		Status:       "success",
		Source:       "watcher",
		Details: map[string]interface{}{
			"path": relPath,
		},
	})
}

// RecordIndexFailed logs watcher/indexer failures.
func RecordIndexFailed(db *sqlite.DB, relPath string, err error) {
	if db == nil {
		return
	}
	details := map[string]interface{}{"path": relPath}
	if err != nil {
		details["error"] = err.Error()
	}
	Record(db, Entry{
		Level:        "error",
		Category:     "watcher",
		Action:       "index_failed",
		Message:      fmt.Sprintf("索引失败：%s", relPath),
		ResourceType: "file",
		ResourceID:   relPath,
		Status:       "failure",
		Source:       "watcher",
		Details:      details,
	})
}

// ResetDebounce clears pending debounce timers (for tests).
func ResetDebounce() {
	debounceMu.Lock()
	defer debounceMu.Unlock()
	for k, t := range pending {
		t.Stop()
		delete(pending, k)
	}
}
