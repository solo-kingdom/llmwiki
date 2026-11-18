package postgres_test

import (
	"context"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func doc(rel, title, content string) *store.Document {
	return &store.Document{
		RelativePath: rel,
		Filename:     "a.md",
		Title:        title,
		Path:         "/wiki/",
		SourceKind:   "wiki",
		FileType:     "md",
		Content:      content,
	}
}

func TestApplyChangeSetUndoRestore(t *testing.T) {
	db := pgtest.Open(t)
	ctx := context.Background()

	cs := &store.ChangeSet{Kind: "ingest", Summary: "first ingest"}
	if err := db.ApplyChangeSet(cs, []store.PageWrite{{
		Document:  doc("wiki/a.md", "A", "one"),
		Operation: store.RevisionCreate,
		Chunks:    []store.Chunk{{ChunkIndex: 0, Content: "one", TokenCount: 1}},
	}}); err != nil {
		t.Fatalf("apply create: %v", err)
	}
	revs, err := db.ListChangeSetRevisions(cs.ID)
	if err != nil || len(revs) != 1 {
		t.Fatalf("revisions = %d, err=%v", len(revs), err)
	}
	if revs[0].Content != "one" || revs[0].Operation != store.RevisionCreate {
		t.Fatalf("unexpected revision: %+v", revs[0])
	}

	cs2 := &store.ChangeSet{Kind: "manual", Summary: "update"}
	if err := db.ApplyChangeSet(cs2, []store.PageWrite{{
		Document:  doc("wiki/a.md", "A", "two"),
		Operation: store.RevisionUpdate,
	}}); err != nil {
		t.Fatalf("apply update: %v", err)
	}
	latest, err := db.LatestRevision(revs[0].DocumentID)
	if err != nil || latest == nil || latest.Content != "two" {
		t.Fatalf("latest = %+v, err=%v", latest, err)
	}

	rb, err := db.UndoChangeSet(cs2.ID, "test")
	if err != nil {
		t.Fatalf("undo: %v", err)
	}
	if rb.Kind != "rollback" || rb.RollbackOf != cs2.ID || rb.PageCount != 1 {
		t.Fatalf("unexpected rollback change set: %+v", rb)
	}
	var content, deletedAt string
	if err := db.Pool().QueryRow(ctx, `SELECT content, deleted_at FROM documents WHERE relative_path='wiki/a.md'`).Scan(&content, &deletedAt); err != nil {
		t.Fatalf("read document: %v", err)
	}
	if content != "one" || deletedAt != "" {
		t.Fatalf("after undo content=%q deleted_at=%q", content, deletedAt)
	}

	restored, err := db.RestoreRevision(latest.ID, "test")
	if err != nil {
		t.Fatalf("restore revision: %v", err)
	}
	if restored.Summary == "" || restored.PageCount != 1 {
		t.Fatalf("unexpected restore change set: %+v", restored)
	}
	if err := db.Pool().QueryRow(ctx, `SELECT content FROM documents WHERE relative_path='wiki/a.md'`).Scan(&content); err != nil {
		t.Fatalf("read restored document: %v", err)
	}
	if content != "two" {
		t.Fatalf("after restore content=%q", content)
	}

	del := &store.ChangeSet{Kind: "delete", Summary: "delete"}
	if err := db.ApplyChangeSet(del, []store.PageWrite{{RelativePath: "wiki/a.md", Operation: store.RevisionDelete}}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := db.Pool().QueryRow(ctx, `SELECT content, deleted_at FROM documents WHERE relative_path='wiki/a.md'`).Scan(&content, &deletedAt); err != nil {
		t.Fatalf("read deleted document: %v", err)
	}
	if deletedAt == "" {
		t.Fatal("document should be soft-deleted")
	}
	history, err := db.ListPageRevisions("wiki/a.md", 10)
	if err != nil || len(history) < 4 {
		t.Fatalf("history len=%d err=%v", len(history), err)
	}

	sets, err := db.ListChangeSets(10, "")
	if err != nil || len(sets) != 5 {
		t.Fatalf("change sets=%d err=%v", len(sets), err)
	}
}
