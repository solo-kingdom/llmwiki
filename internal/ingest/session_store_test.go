package ingest

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizeSessionArchivePath(t *testing.T) {
	n, err := NormalizeSessionArchive("abc123", "My Topic", "# hello", "session:abc123", time.Date(2026, 5, 19, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if n.Kind != InputKindSessionArchive {
		t.Fatalf("kind = %q", n.Kind)
	}
	if !strings.Contains(n.CanonicalPath, "sessions/abc123/archive-") {
		t.Fatalf("path = %q", n.CanonicalPath)
	}
}

func TestDefaultIngestSessionTitle(t *testing.T) {
	now := time.Date(2026, 5, 20, 15, 30, 0, 0, time.UTC)
	got := DefaultIngestSessionTitle(3, now)
	want := "#3 2026-05-20"
	if got != want {
		t.Fatalf("title = %q, want %q", got, want)
	}
}

func TestBuildSessionArchiveMarkdown(t *testing.T) {
	md := BuildSessionArchiveMarkdown("s1", "T", []SessionArchiveMessage{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
	}, time.Now())
	if !strings.Contains(md, "session_id: s1") || !strings.Contains(md, "hi") {
		t.Fatalf("unexpected markdown: %s", md)
	}
}
