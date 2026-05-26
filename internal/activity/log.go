package activity

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const (
	channelSize     = 256
	DefaultMaxCount = 10000
	MinMaxCount     = 100
	MaxMaxCount     = 100000
)

// Entry is a single activity log event to record.
type Entry struct {
	Level        string
	Category     string
	Action       string
	Message      string
	ResourceType string
	ResourceID   string
	Status       string
	Details      map[string]interface{}
	Source       string
}

var (
	mu       sync.Mutex
	ch       chan writeReq
	started  bool
	stopCh   chan struct{}
	wg       sync.WaitGroup
)

type writeReq struct {
	db    *sqlite.DB
	entry Entry
}

// Start begins the background writer goroutine. Safe to call once per process.
func Start() {
	mu.Lock()
	defer mu.Unlock()
	if started {
		return
	}
	ch = make(chan writeReq, channelSize)
	stopCh = make(chan struct{})
	started = true
	wg.Add(1)
	go worker()
}

// Stop shuts down the background writer (for tests).
func Stop() {
	mu.Lock()
	if !started {
		mu.Unlock()
		return
	}
	close(stopCh)
	mu.Unlock()
	wg.Wait()
	mu.Lock()
	started = false
	ch = nil
	stopCh = nil
	mu.Unlock()
}

// Flush waits until queued writes are processed (for tests).
func Flush() {
	mu.Lock()
	c := ch
	mu.Unlock()
	if c == nil {
		return
	}
	done := make(chan struct{})
	go func() {
		for {
			if len(c) == 0 {
				close(done)
				return
			}
		}
	}()
	<-done
}

func worker() {
	defer wg.Done()
	for {
		select {
		case <-stopCh:
			for {
				select {
				case req := <-ch:
					writeOne(req.db, req.entry)
				default:
					return
				}
			}
		case req := <-ch:
			writeOne(req.db, req.entry)
		}
	}
}

// Record enqueues an activity log write (non-blocking).
func Record(db *sqlite.DB, entry Entry) {
	if db == nil {
		return
	}
	mu.Lock()
	c := ch
	s := started
	mu.Unlock()
	if !s {
		writeOne(db, entry)
		return
	}
	select {
	case c <- writeReq{db: db, entry: entry}:
	default:
		log.Printf("activity: log channel full, dropping %s/%s", entry.Category, entry.Action)
	}
}

// RecordSync writes immediately (for system events that must land before response).
func RecordSync(db *sqlite.DB, entry Entry) {
	if db == nil {
		return
	}
	writeOne(db, entry)
}

func writeOne(db *sqlite.DB, entry Entry) {
	details := SanitizeDetails(entry.Details)
	detailsJSON := ""
	if len(details) > 0 {
		b, err := json.Marshal(details)
		if err == nil {
			detailsJSON = string(b)
		}
	}
	row := &sqlite.ActivityLog{
		Level:        entry.Level,
		Category:     entry.Category,
		Action:       entry.Action,
		Message:      entry.Message,
		ResourceType: entry.ResourceType,
		ResourceID:   entry.ResourceID,
		Status:       entry.Status,
		Details:      detailsJSON,
		Source:       entry.Source,
	}
	if err := db.CreateActivityLog(row); err != nil {
		log.Printf("activity: write failed %s/%s: %v", entry.Category, entry.Action, err)
	}
}

// TrimActivityLogsIfNeeded trims when count exceeds maxCount; returns deleted count.
func TrimActivityLogsIfNeeded(db *sqlite.DB, maxCount int) (int64, error) {
	if db == nil {
		return 0, nil
	}
	return db.TrimActivityLogs(maxCount)
}

// GetMaxCount reads activity_logs_max_count from config with defaults and bounds.
func GetMaxCount(db *sqlite.DB) int {
	if db == nil {
		return DefaultMaxCount
	}
	raw, _ := db.GetConfig("activity_logs_max_count")
	if raw == "" {
		return DefaultMaxCount
	}
	n, err := ParseMaxCount(raw)
	if err != nil {
		return DefaultMaxCount
	}
	return n
}

// ParseMaxCount validates configured max count.
func ParseMaxCount(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return DefaultMaxCount, nil
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, fmt.Errorf("invalid activity_logs_max_count: %q", s)
	}
	if n < MinMaxCount || n > MaxMaxCount {
		return 0, fmt.Errorf("activity_logs_max_count must be between %d and %d", MinMaxCount, MaxMaxCount)
	}
	return n, nil
}

// LogTrimmed records a system logs_trimmed event when rows were deleted.
func LogTrimmed(db *sqlite.DB, deletedCount int64, maxCount, remaining int) {
	if deletedCount <= 0 {
		return
	}
	RecordSync(db, Entry{
		Level:    "info",
		Category: "system",
		Action:   "logs_trimmed",
		Message:  fmt.Sprintf("自动清理了 %d 条最旧系统日志", deletedCount),
		Source:   "processor",
		Details: map[string]interface{}{
			"deleted_count":    deletedCount,
			"max_count":        maxCount,
			"remaining_count":  remaining,
		},
	})
}
