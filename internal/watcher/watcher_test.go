package watcher

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestNew(t *testing.T) {
	dir := t.TempDir()

	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if w == nil {
		t.Fatal("New() returned nil")
	}
	w.Stop()
}

func TestNewWithInvalidPath(t *testing.T) {
	w, err := New("/nonexistent/path/that/does/not/exist", func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() should not error on creation, got: %v", err)
	}
	w.Stop()
}

func TestMarkWritten(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	testPath := filepath.Join(dir, "test.md")
	w.MarkWritten(testPath)

	w.mu.Lock()
	ts, ok := w.written[testPath]
	w.mu.Unlock()

	if !ok {
		t.Error("expected path to be in written map after MarkWritten")
	}
	if time.Since(ts) > time.Second {
		t.Error("expected recent timestamp for MarkWritten entry")
	}
}

func TestMarkWrittenMultiplePaths(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	paths := []string{
		filepath.Join(dir, "a.md"),
		filepath.Join(dir, "b.md"),
		filepath.Join(dir, "c.md"),
	}
	for _, p := range paths {
		w.MarkWritten(p)
	}

	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.written) != len(paths) {
		t.Errorf("expected %d written entries, got %d", len(paths), len(w.written))
	}
}

func TestClassifyEventCreate(t *testing.T) {
	event := fsnotify.Event{Name: "test.md", Op: fsnotify.Create}
	if ct := classifyEvent(event); ct != ChangeCreated {
		t.Errorf("expected ChangeCreated, got %d", ct)
	}
}

func TestClassifyEventModify(t *testing.T) {
	event := fsnotify.Event{Name: "test.md", Op: fsnotify.Write}
	if ct := classifyEvent(event); ct != ChangeModified {
		t.Errorf("expected ChangeModified, got %d", ct)
	}
}

func TestClassifyEventDelete(t *testing.T) {
	event := fsnotify.Event{Name: "test.md", Op: fsnotify.Remove}
	if ct := classifyEvent(event); ct != ChangeDeleted {
		t.Errorf("expected ChangeDeleted, got %d", ct)
	}
}

func TestClassifyEventRename(t *testing.T) {
	event := fsnotify.Event{Name: "test.md", Op: fsnotify.Rename}
	if ct := classifyEvent(event); ct != ChangeDeleted {
		t.Errorf("expected ChangeDeleted for Rename, got %d", ct)
	}
}

func TestClassifyEventUnknown(t *testing.T) {
	event := fsnotify.Event{Name: "test.md", Op: fsnotify.Chmod}
	if ct := classifyEvent(event); ct != ChangeType(-1) {
		t.Errorf("expected -1 for Chmod, got %d", ct)
	}
}

func TestShouldIgnoreGitDir(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	gitPath := filepath.Join(dir, ".git", "HEAD")
	if !w.shouldIgnore(gitPath) {
		t.Error("expected .git path to be ignored")
	}
}

func TestShouldIgnoreLlmwikiDir(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	llmwikiPath := filepath.Join(dir, ".llmwiki", "index.db")
	if !w.shouldIgnore(llmwikiPath) {
		t.Error("expected .llmwiki path to be ignored")
	}
}

func TestShouldIgnoreNodeModules(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	nodePath := filepath.Join(dir, "node_modules", "react", "index.js")
	if !w.shouldIgnore(nodePath) {
		t.Error("expected node_modules path to be ignored")
	}
}

func TestShouldIgnoreWrittenCooldown(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	testPath := filepath.Join(dir, "subdir", "test.md")
	w.MarkWritten(testPath)

	if !w.shouldIgnore(testPath) {
		t.Error("expected recently written path to be ignored during cooldown")
	}
}

func TestShouldNotIgnoreNormalFile(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	normalPath := filepath.Join(dir, "wiki", "page.md")
	if w.shouldIgnore(normalPath) {
		t.Error("expected normal wiki file to NOT be ignored")
	}
}

func TestDebounceBatching(t *testing.T) {
	dir := t.TempDir()

	var receivedChanges []Change
	done := make(chan struct{})
	w, err := New(dir, func(changes []Change) {
		receivedChanges = changes
		close(done)
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	if err := w.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	err = os.WriteFile(filepath.Join(dir, "test.md"), []byte("hello"), 0644)
	if err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	select {
	case <-done:
		if len(receivedChanges) == 0 {
			t.Error("expected batched changes")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for debounced changes")
	}
}

func TestIgnoreDirs(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	expectedIgnored := map[string]bool{
		".git":         true,
		".llmwiki":     true,
		"node_modules": true,
		"__pycache__":  true,
		".venv":        true,
		"venv":         true,
	}

	for d := range expectedIgnored {
		if !w.ignoreDirs[d] {
			t.Errorf("expected %q to be in ignoreDirs", d)
		}
	}
}

func TestSetIndexer(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	mock := &mockIndexer{}
	w.SetIndexer(mock)
	if w.indexer != mock {
		t.Error("expected indexer to be set")
	}
}

func TestProcessChangesWithIndexer(t *testing.T) {
	dir := t.TempDir()
	w, err := New(dir, func(changes []Change) {})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer w.Stop()

	mock := &mockIndexer{}
	w.SetIndexer(mock)

	changes := []Change{
		{Path: filepath.Join(dir, "new.md"), Type: ChangeCreated},
		{Path: filepath.Join(dir, "mod.md"), Type: ChangeModified},
		{Path: filepath.Join(dir, "del.md"), Type: ChangeDeleted},
	}

	w.ProcessChanges(changes)

	if mock.indexed != 1 {
		t.Errorf("expected 1 IndexFile call, got %d", mock.indexed)
	}
	if mock.updated != 1 {
		t.Errorf("expected 1 UpdateFile call, got %d", mock.updated)
	}
	if mock.removed != 1 {
		t.Errorf("expected 1 RemoveFile call, got %d", mock.removed)
	}
}

type mockIndexer struct {
	indexed int
	updated int
	removed int
}

func (m *mockIndexer) IndexFile(relPath string) error {
	m.indexed++
	return nil
}

func (m *mockIndexer) UpdateFile(relPath string) error {
	m.updated++
	return nil
}

func (m *mockIndexer) RemoveFile(relPath string) error {
	m.removed++
	return nil
}
