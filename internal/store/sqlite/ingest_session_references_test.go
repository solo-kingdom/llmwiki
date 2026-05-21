package sqlite

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUpsertSessionReferenceUniqueAndSource(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, ".llmwiki", "index.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	s := &IngestSession{Title: "t"}
	if err := db.CreateIngestSession(s); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}

	doc := &Document{
		Filename:     "a.md",
		Title:        "Alpha",
		Path:         "/wiki/",
		RelativePath: "wiki/concepts/a.md",
		SourceKind:   "wiki",
		Status:       "ready",
		FileType:     "md",
	}
	if err := db.CreateDocument(doc); err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}

	if err := db.UpsertSessionReference(s.ID, doc.ID, doc.RelativePath, doc.Title, SessionRefSourceUserMention); err != nil {
		t.Fatalf("UpsertSessionReference: %v", err)
	}
	n, err := db.CountSessionReference(s.ID, doc.ID)
	if err != nil || n != 1 {
		t.Fatalf("count = %d err=%v", n, err)
	}

	if err := db.UpsertSessionReference(s.ID, doc.ID, doc.RelativePath, doc.Title, SessionRefSourceToolRead); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	refs, err := db.ListSessionReferences(s.ID)
	if err != nil {
		t.Fatalf("ListSessionReferences: %v", err)
	}
	if len(refs) != 1 {
		t.Fatalf("want 1 ref, got %d", len(refs))
	}
	if refs[0].Source != SessionRefSourceUserMention {
		t.Fatalf("user_mention should win over tool_read, got %q", refs[0].Source)
	}

	if err := db.UpsertSessionReference(s.ID, doc.ID, doc.RelativePath, doc.Title, "invalid"); err == nil {
		t.Fatal("expected invalid source error")
	}
}

func TestListSessionReferencesEmpty(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, ".llmwiki", "index.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	s := &IngestSession{Title: "t"}
	if err := db.CreateIngestSession(s); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	refs, err := db.ListSessionReferences(s.ID)
	if err != nil {
		t.Fatalf("ListSessionReferences: %v", err)
	}
	if len(refs) != 0 {
		t.Fatalf("want empty slice, got %#v", refs)
	}
	_ = os.RemoveAll(dir)
}
