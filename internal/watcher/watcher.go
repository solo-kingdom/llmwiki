package watcher

import (
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type ChangeType int

const (
	ChangeCreated ChangeType = iota
	ChangeModified
	ChangeDeleted
)

type Change struct {
	Path string
	Type ChangeType
}

type ChangeHandler func(changes []Change)

type Indexer interface {
	IndexFile(relPath string) error
	UpdateFile(relPath string) error
	RemoveFile(relPath string) error
}

type Watcher struct {
	workspace  string
	handler    ChangeHandler
	indexer    Indexer
	watcher    *fsnotify.Watcher
	written    map[string]time.Time
	cooldown   time.Duration
	debounce   time.Duration
	mu         sync.Mutex
	ignoreDirs map[string]bool
	done       chan struct{}
	running    bool
}

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

func (w *Watcher) SetIndexer(indexer Indexer) {
	w.indexer = indexer
}

func (w *Watcher) MarkWritten(path string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.written[path] = time.Now()
}

func (w *Watcher) Start() error {
	if w.running {
		return nil
	}
	w.running = true

	if err := w.watcher.Add(w.workspace); err != nil {
		return err
	}

	for _, sub := range []string{"raw/sources", "wiki"} {
		path := filepath.Join(w.workspace, sub)
		if dirExists(path) {
			w.watcher.Add(path)
		}
	}

	go w.loop()

	if runtime.GOOS == "linux" {
		go w.periodicRescan()
	}

	log.Printf("File watcher started on: %s", w.workspace)
	return nil
}

func (w *Watcher) Stop() {
	if !w.running {
		return
	}
	close(w.done)
	w.watcher.Close()
	w.running = false
}

func (w *Watcher) ProcessChanges(changes []Change) {
	if w.indexer == nil {
		if w.handler != nil {
			w.handler(changes)
		}
		return
	}

	for _, change := range changes {
		rel, err := filepath.Rel(w.workspace, change.Path)
		if err != nil {
			continue
		}

		switch change.Type {
		case ChangeCreated:
			if err := w.indexer.IndexFile(rel); err != nil {
				log.Printf("IndexFile error for %s: %v", rel, err)
			}
		case ChangeModified:
			if err := w.indexer.UpdateFile(rel); err != nil {
				log.Printf("UpdateFile error for %s: %v", rel, err)
			}
		case ChangeDeleted:
			if err := w.indexer.RemoveFile(rel); err != nil {
				log.Printf("RemoveFile error for %s: %v", rel, err)
			}
		}
	}

	if w.handler != nil {
		w.handler(changes)
	}
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
			w.ProcessChanges(changes)
		}
	}
}

func (w *Watcher) periodicRescan() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	fileMtimes := make(map[string]time.Time)
	w.scanDir(fileMtimes)

	for {
		select {
		case <-w.done:
			return
		case <-ticker.C:
			w.scanDir(fileMtimes)
		}
	}
}

func (w *Watcher) scanDir(known map[string]time.Time) {
	current := make(map[string]time.Time)

	filepath.Walk(w.workspace, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			name := info.Name()
			if name != "" && (w.ignoreDirs[name] || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		rel, err := filepath.Rel(w.workspace, path)
		if err != nil {
			return nil
		}
		current[rel] = info.ModTime()
		return nil
	})

	if w.indexer == nil {
		for rel := range current {
			known[rel] = current[rel]
		}
		return
	}

	for rel, mtime := range current {
		prev, exists := known[rel]
		if !exists {
			if err := w.indexer.IndexFile(rel); err != nil {
				log.Printf("Rescan IndexFile %s: %v", rel, err)
			}
		} else if mtime.After(prev) {
			if err := w.indexer.UpdateFile(rel); err != nil {
				log.Printf("Rescan UpdateFile %s: %v", rel, err)
			}
		}
	}

	for rel := range known {
		if _, exists := current[rel]; !exists {
			if err := w.indexer.RemoveFile(rel); err != nil {
				log.Printf("Rescan RemoveFile %s: %v", rel, err)
			}
		}
	}

	for k := range known {
		delete(known, k)
	}
	for k, v := range current {
		known[k] = v
	}
}

func (w *Watcher) shouldIgnore(path string) bool {
	w.mu.Lock()
	ts, ok := w.written[path]
	if ok && time.Since(ts) < w.cooldown {
		w.mu.Unlock()
		return true
	}
	w.mu.Unlock()

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
