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
	md := BuildSessionArchiveMarkdown("s1", "T", "", []SessionArchiveMessage{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
	}, []SessionArchiveReference{
		{Path: "wiki/concepts/a.md", Title: "A", Source: "user_mention"},
	}, time.Now())
	if !strings.Contains(md, "session_id: s1") || !strings.Contains(md, "hi") {
		t.Fatalf("unexpected markdown: %s", md)
	}
	if !strings.Contains(md, "referenced_wiki_pages") || !strings.Contains(md, "## Referenced Wiki Pages") {
		t.Fatalf("expected referenced pages section: %s", md)
	}
	// Default mode (ingest) should NOT include session_mode in frontmatter
	if strings.Contains(md, "session_mode:") {
		t.Fatalf("ingest mode should not emit session_mode: %s", md)
	}
}

func TestBuildSessionArchiveMarkdownWithMode(t *testing.T) {
	md := BuildSessionArchiveMarkdown("s1", "T", "organize", []SessionArchiveMessage{
		{Role: "user", Content: "整理 wiki"},
	}, nil, time.Now())
	if !strings.Contains(md, "session_mode: organize") {
		t.Fatalf("expected session_mode in frontmatter: %s", md)
	}
}

func TestParseSessionModeFromArchive(t *testing.T) {
	content := "---\nsession_id: s1\nsession_mode: qa\n---\n\n# body"
	mode := ParseSessionModeFromArchive(content)
	if mode != "qa" {
		t.Fatalf("expected mode 'qa', got %q", mode)
	}

	// No mode field
	content2 := "---\nsession_id: s2\n---\n\n# body"
	mode2 := ParseSessionModeFromArchive(content2)
	if mode2 != "" {
		t.Fatalf("expected empty mode, got %q", mode2)
	}
}

func TestParseReferencedWikiPagesFromArchive(t *testing.T) {
	content := "---\nreferenced_wiki_pages:\n  - path: wiki/a.md\n    title: A\n    source: tool_read\n---\n\n# body"
	refs := ParseReferencedWikiPagesFromArchive(content)
	if len(refs) != 1 || refs[0].Path != "wiki/a.md" {
		t.Fatalf("refs = %#v", refs)
	}
}
