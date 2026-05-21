package ingest

import (
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPageLockManagerSamePageContention(t *testing.T) {
	plm := NewPageLockManager()
	var counter int64
	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			plm.Lock("wiki/page.md")
			atomic.AddInt64(&counter, 1)
			plm.Unlock("wiki/page.md")
		}()
	}

	wg.Wait()

	if got := atomic.LoadInt64(&counter); got != 10 {
		t.Errorf("expected 10 increments, got %d", got)
	}
}

func TestPageLockManagerCrossFileParallelism(t *testing.T) {
	plm := NewPageLockManager()

	var entered int64
	var wg sync.WaitGroup
	done := make(chan struct{})

	startBarrier := make(chan struct{})

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			path := filepath.Join("wiki", string(rune('a'+i))+".md")
			plm.Lock(path)
			atomic.AddInt64(&entered, 1)
			<-startBarrier
			plm.Unlock(path)
		}(i)
	}

	for atomic.LoadInt64(&entered) < 5 {
		time.Sleep(time.Millisecond)
	}
	close(startBarrier)

	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cross-file parallelism deadlock")
	}

	if got := atomic.LoadInt64(&entered); got != 5 {
		t.Errorf("expected 5, got %d", got)
	}
}

func TestPageLockManagerNormalization(t *testing.T) {
	plm := NewPageLockManager()

	plm.Lock("/Wiki/Page.md")
	var acquired int64
	go func() {
		plm.Lock("wiki/page.md")
		atomic.StoreInt64(&acquired, 1)
		plm.Unlock("wiki/page.md")
	}()

	time.Sleep(50 * time.Millisecond)
	if got := atomic.LoadInt64(&acquired); got != 0 {
		t.Error("should still be locked (normalized paths collide)")
	}

	plm.Unlock("/Wiki/Page.md")

	time.Sleep(50 * time.Millisecond)
	if got := atomic.LoadInt64(&acquired); got != 1 {
		t.Error("should have been acquired after unlock")
	}
}

func TestPageLockManagerUnlockMissing(t *testing.T) {
	plm := NewPageLockManager()
	plm.Unlock("nonexistent")
}

func TestPageLockManagerStats(t *testing.T) {
	plm := NewPageLockManager()

	plm.Lock("test/page.md")
	time.Sleep(10 * time.Millisecond)
	plm.Unlock("test/page.md")

	var gotStats []LockStats
	timeout := time.After(time.Second)
collect:
	for {
		select {
		case s := <-plm.Stats():
			gotStats = append(gotStats, s)
			if len(gotStats) >= 2 {
				break collect
			}
		case <-timeout:
			break collect
		}
	}

	if len(gotStats) < 2 {
		t.Fatalf("expected at least 2 stats, got %d", len(gotStats))
	}

	var hasWait, hasHold bool
	for _, s := range gotStats {
		if s.WaitDuration > 0 {
			hasWait = true
		}
		if s.HoldDuration > 0 {
			hasHold = true
		}
	}

	if !hasWait {
		t.Error("expected a wait duration stat")
	}
	if !hasHold {
		t.Error("expected a hold duration stat")
	}
}

func TestPageLockManagerActiveLocks(t *testing.T) {
	plm := NewPageLockManager()

	plm.Lock("a.md")
	plm.Lock("b.md")

	active := plm.ActiveLocks()
	if len(active) != 2 {
		t.Errorf("expected 2 active locks, got %d", len(active))
	}

	plm.Unlock("a.md")
	plm.Unlock("b.md")

	active = plm.ActiveLocks()
	if len(active) != 0 {
		t.Errorf("expected 0 active locks after unlock, got %d", len(active))
	}
}

func TestPageLockManagerRefCountCleanup(t *testing.T) {
	plm := NewPageLockManager()

	plm.Lock("page.md")

	var wg sync.WaitGroup
	wg.Add(1)
	ready := make(chan struct{})
	go func() {
		defer wg.Done()
		close(ready)
		plm.Lock("page.md")
		plm.Unlock("page.md")
	}()

	<-ready
	time.Sleep(10 * time.Millisecond)

	if len(plm.ActiveLocks()) != 1 {
		t.Error("expected 1 lock entry for same page")
	}

	plm.Unlock("page.md")

	wg.Wait()

	if len(plm.ActiveLocks()) != 0 {
		t.Error("should be cleaned up after last unlock")
	}
}

func TestNewPageLockManager(t *testing.T) {
	plm := NewPageLockManager()
	if plm == nil {
		t.Fatal("NewPageLockManager returned nil")
	}
	if plm.locks == nil {
		t.Error("locks map not initialized")
	}
}

func TestNormalizePath(t *testing.T) {
	tests := []struct{ in, want string }{
		{"/Wiki/Page.md", "wiki/page.md"},
		{"wiki/page.md/", "wiki/page.md"},
		{"/wiki/page.md/", "wiki/page.md"},
		{"WIKI/PAGE.MD", "wiki/page.md"},
		{"page.md", "page.md"},
	}
	for _, tt := range tests {
		got := normalizePath(tt.in)
		if got != tt.want {
			t.Errorf("normalizePath(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestParseFileBlocks(t *testing.T) {
	input := `Here are the files:
---FILE: wiki/go.md
# Go Programming
Go is a statically typed language.
---END FILE---
Some text between blocks.
---FILE: wiki/rust.md
# Rust Programming
Rust is a systems language.
---END FILE---
`
	files := parseFileBlocks(input)
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	if files[0] != "wiki/go.md" {
		t.Errorf("files[0] = %q, want %q", files[0], "wiki/go.md")
	}
	if files[1] != "wiki/rust.md" {
		t.Errorf("files[1] = %q, want %q", files[1], "wiki/rust.md")
	}
}

func TestParseFileBlocksEmpty(t *testing.T) {
	files := parseFileBlocks("no file blocks here")
	if len(files) != 0 {
		t.Errorf("expected 0 files, got %d", len(files))
	}
}

type mockJobRecorder struct {
	events []struct{ step, phase string }
}

func (m *mockJobRecorder) Record(step, phase, message string, payload map[string]any) {
	m.events = append(m.events, struct{ step, phase string }{step, phase})
}

func TestPipelineSetJobRecorder(t *testing.T) {
	p := NewPipeline(t.TempDir(), nil)
	rec := &mockJobRecorder{}
	p.SetJobRecorder(rec)
	if p.recorder != rec {
		t.Fatal("recorder not set")
	}
}

func TestLanguageInstructionForPipeline(t *testing.T) {
	tests := []struct {
		lang       string
		wantContains string
	}{
		{"zh", "中文"},
		{"en", "English"},
		{"", ""},
		{"fr", ""},
	}
	for _, tt := range tests {
		got := languageInstructionForPipeline(tt.lang)
		if tt.wantContains != "" && got == "" {
			t.Errorf("languageInstructionForPipeline(%q) returned empty, want to contain %q", tt.lang, tt.wantContains)
		}
		if tt.wantContains != "" && !containsString(got, tt.wantContains) {
			t.Errorf("languageInstructionForPipeline(%q) = %q, want to contain %q", tt.lang, got, tt.wantContains)
		}
		if tt.wantContains == "" && got != "" {
			t.Errorf("languageInstructionForPipeline(%q) = %q, want empty", tt.lang, got)
		}
	}
}

func TestPipelineSetDocLanguage(t *testing.T) {
	p := NewPipeline(t.TempDir(), nil)
	p.SetDocLanguage("en")
	if p.docLang != "en" {
		t.Errorf("expected docLang 'en', got %q", p.docLang)
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStringHelper(s, substr))
}

func containsStringHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
