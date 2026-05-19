// Package watcher provides filesystem monitoring for LLM Wiki.
package watcher

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// ChangeType indicates the type of filesystem change.
type ChangeType int

const (
	ChangeCreated ChangeType = iota
	ChangeModified
	ChangeDeleted
)

// Change represents a detected filesystem change.
type Change struct {
	Path string
	Type ChangeType
}

// ChangeHandler is a callback for processing detected changes.
type ChangeHandler func(changes []Change)

// Watcher monitors a workspace directory for file changes.
type Watcher struct {
	workspace  string
	handler    ChangeHandler
	watcher    *fsnotify.Watcher
	written    map[string]time.Time
	cooldown   time.Duration
	debounce   time.Duration
	mu         sync.Mutex
	ignoreDirs map[string]bool
	done       chan struct{}
	running    bool
}

// New creates a new file watcher.
func New(workspace string, handler ChangeHandler) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	return &Watcher{
		workspace: workspace,
		handler:   handler,
		watcher:   fsw,
		written:   make(map[string]time.Time),
		cooldown:  4 * time.Second,
		debounce:  700 * time.Millisecond,
		ignoreDirs: map[string]bool{
			".llmwiki":    true,
			".git":        true,
			"node_modules": true,
			"__pycache__":  true,
			".venv":       true,
			"venv":        true,
		},
		done: make(chan struct{}),
	}, nil
}

// MarkWritten records a path as recently written by the app itself,
// preventing the watcher from triggering a re-index loop.
func (w *Watcher) MarkWritten(path string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.written[path] = time.Now()
}

// Start begins watching the workspace.
func (w *Watcher) Start() error {
	if w.running {
		return nil
	}
	w.running = true

	// Watch workspace recursively
	if err := w.watcher.Add(w.workspace); err != nil {
		return err
	}

	// Add specific subdirectories if they exist
	for _, sub := range []string{"raw/sources", "wiki"} {
		path := filepath.Join(w.workspace, sub)
		if dirExists(path) {
			w.watcher.Add(path)
		}
	}

	go w.loop()
	log.Printf("File watcher started on: %s", w.workspace)
	return nil
}

// Stop stops watching and cleans up.
func (w *Watcher) Stop() {
	if !w.running {
		return
	}
	close(w.done)
	w.watcher.Close()
	w.running = false
}

func (w *Watcher) loop() {
	pending := make(map[string]ChangeType)
	timer := time.NewTimer(w.debounce)
	timer.Stop()

	for {
		select {
		case <-w.done:
			return
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			if w.shouldIgnore(event.Name) {
				continue
			}
			ct := classifyEvent(event)
			if ct < 0 {
				continue
			}
			pending[event.Name] = ct
			timer.Reset(w.debounce)

		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Watcher error: %v", err)

		case <-timer.C:
			if len(pending) == 0 {
				continue
			}
			changes := make([]Change, 0, len(pending))
			for path, ct := range pending {
				changes = append(changes, Change{Path: path, Type: ct})
			}
			pending = make(map[string]ChangeType)
			if w.handler != nil {
				w.handler(changes)
			}
		}
	}
}

func (w *Watcher) shouldIgnore(path string) bool {
	// Check self-write cooldown
	w.mu.Lock()
	ts, ok := w.written[path]
	if ok && time.Since(ts) < w.cooldown {
		w.mu.Unlock()
		return true
	}
	w.mu.Unlock()

	// Check ignored directories
	rel, err := filepath.Rel(w.workspace, path)
	if err != nil {
		return true
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	for _, part := range parts {
		if w.ignoreDirs[part] {
			return true
		}
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

func classifyEvent(event fsnotify.Event) ChangeType {
	if event.Has(fsnotify.Create) {
		return ChangeCreated
	}
	if event.Has(fsnotify.Write) {
		return ChangeModified
	}
	if event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
		return ChangeDeleted
	}
	return -1
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}
