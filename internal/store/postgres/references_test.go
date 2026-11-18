package postgres_test

import (
	"context"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func countRefs(t *testing.T, db *postgres.DB, sourceID string) int {
	t.Helper()
	var n int
	if err := db.Pool().QueryRow(context.Background(),
		"SELECT COUNT(*) FROM document_references WHERE source_document_id = $1", sourceID).Scan(&n); err != nil {
		t.Fatalf("count refs: %v", err)
	}
	return n
}

func TestUpsertReferenceAndForwardRefs(t *testing.T) {
	db := pgtest.Open(t)
	source := seedPGDoc(t, db, "", "ref-source.md", "/wiki", "wiki/ref-source.md", "wiki")
	target := seedPGDoc(t, db, "", "ref-target.md", "/wiki", "wiki/ref-target.md", "wiki")

	page := 2
	if err := db.UpsertReference(source.ID, target.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference: %v", err)
	}
	page = 5
	if err := db.UpsertReference(source.ID, target.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference second: %v", err)
	}
	if n := countRefs(t, db, source.ID); n != 1 {
		t.Fatalf("ref count = %d, want 1 (upsert)", n)
	}

	refs, err := db.GetForwardReferences(source.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences: %v", err)
	}
	if len(refs) != 1 || refs[0].Page != 5 || refs[0].ReferenceType != "cites" {
		t.Fatalf("forward refs = %+v, want one cites edge at page 5", refs)
	}

	// A different reference type is a separate edge.
	if err := db.UpsertReference(source.ID, target.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference links_to: %v", err)
	}
	if n := countRefs(t, db, source.ID); n != 2 {
		t.Fatalf("ref count = %d, want 2", n)
	}

	backlinks, err := db.GetBacklinks(target.ID)
	if err != nil {
		t.Fatalf("GetBacklinks: %v", err)
	}
	if len(backlinks) != 2 {
		t.Fatalf("backlinks = %+v, want 2", backlinks)
	}

	if err := db.DeleteReferences(source.ID); err != nil {
		t.Fatalf("DeleteReferences: %v", err)
	}
	if n := countRefs(t, db, source.ID); n != 0 {
		t.Fatalf("ref count after delete = %d, want 0", n)
	}
}

func TestFindUncitedSources(t *testing.T) {
	db := pgtest.Open(t)
	cited := seedPGDoc(t, db, "", "cited.pdf", "/sources", "sources/cited.pdf", "source")
	seedPGDoc(t, db, "", "uncited.pdf", "/sources", "sources/uncited.pdf", "source")
	wiki := seedPGDoc(t, db, "", "citer.md", "/wiki", "wiki/citer.md", "wiki")

	if err := db.UpsertReference(wiki.ID, cited.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference: %v", err)
	}

	sources, err := db.FindUncitedSources()
	if err != nil {
		t.Fatalf("FindUncitedSources: %v", err)
	}
	if len(sources) != 1 || sources[0].Filename != "uncited.pdf" {
		t.Fatalf("uncited = %+v, want only uncited.pdf", sources)
	}
}

func TestStalenessPropagation(t *testing.T) {
	db := pgtest.Open(t)
	pageA := seedPGDoc(t, db, "", "pageA.md", "/wiki", "wiki/pageA.md", "wiki")
	pageB := seedPGDoc(t, db, "", "pageB.md", "/wiki", "wiki/pageB.md", "wiki")
	pageC := seedPGDoc(t, db, "", "pageC.md", "/wiki", "wiki/pageC.md", "wiki")

	if err := db.UpsertReference(pageA.ID, pageB.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference links_to: %v", err)
	}
	if err := db.UpsertReference(pageC.ID, pageB.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference cites: %v", err)
	}

	if err := db.PropagateStaleness(pageB.ID); err != nil {
		t.Fatalf("PropagateStaleness: %v", err)
	}

	gotA, err := db.GetDocument(pageA.ID)
	if err != nil {
		t.Fatalf("GetDocument(pageA): %v", err)
	}
	if gotA.StaleSince == "" {
		t.Error("pageA should be stale")
	}
	gotC, err := db.GetDocument(pageC.ID)
	if err != nil {
		t.Fatalf("GetDocument(pageC): %v", err)
	}
	if gotC.StaleSince != "" {
		t.Error("pageC (cites) should not be stale")
	}

	pages, err := db.FindStalePages()
	if err != nil {
		t.Fatalf("FindStalePages: %v", err)
	}
	if len(pages) != 1 || pages[0].Filename != "pageA.md" {
		t.Fatalf("stale pages = %+v, want pageA.md", pages)
	}

	// Second propagation must not change stale_since.
	if err := db.PropagateStaleness(pageB.ID); err != nil {
		t.Fatalf("PropagateStaleness second: %v", err)
	}
	again, err := db.GetDocument(pageA.ID)
	if err != nil {
		t.Fatalf("GetDocument(pageA) second: %v", err)
	}
	if gotA.StaleSince != again.StaleSince {
		t.Errorf("stale_since changed: %q -> %q", gotA.StaleSince, again.StaleSince)
	}
}

func TestReplaceReferencesInTx(t *testing.T) {
	db := pgtest.Open(t)
	source := seedPGDoc(t, db, "", "tx-source.md", "/wiki", "wiki/tx-source.md", "wiki")
	target1 := seedPGDoc(t, db, "", "tx-target1.md", "/wiki", "wiki/tx-target1.md", "wiki")
	target2 := seedPGDoc(t, db, "", "tx-target2.md", "/wiki", "wiki/tx-target2.md", "wiki")

	if err := db.UpsertReference(source.ID, target1.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference: %v", err)
	}
	if err := db.ReplaceReferencesInTx(source.ID, []store.RefEdge{
		{SourceID: source.ID, TargetID: target2.ID, RefType: "cites"},
	}); err != nil {
		t.Fatalf("ReplaceReferencesInTx: %v", err)
	}

	refs, err := db.GetForwardReferences(source.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences: %v", err)
	}
	if len(refs) != 1 || refs[0].Filename != "tx-target2.md" {
		t.Fatalf("forward refs = %+v, want only tx-target2.md", refs)
	}

	// Invalid target rolls the whole replacement back.
	if err := db.ReplaceReferencesInTx(source.ID, []store.RefEdge{
		{SourceID: source.ID, TargetID: "nonexistent-doc-id", RefType: "cites"},
	}); err == nil {
		t.Fatal("expected error for nonexistent target")
	}
	refs, err = db.GetForwardReferences(source.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences after rollback: %v", err)
	}
	if len(refs) != 1 || refs[0].Filename != "tx-target2.md" {
		t.Fatalf("forward refs after rollback = %+v, want original edge preserved", refs)
	}

	// Empty replacement clears all edges.
	if err := db.ReplaceReferencesInTx(source.ID, nil); err != nil {
		t.Fatalf("ReplaceReferencesInTx empty: %v", err)
	}
	if n := countRefs(t, db, source.ID); n != 0 {
		t.Fatalf("ref count after empty replace = %d, want 0", n)
	}
}

func TestArchiveClearsChunksAndReferences(t *testing.T) {
	db := pgtest.Open(t)
	source := seedPGDoc(t, db, "", "arc-source.md", "/wiki", "wiki/arc-source.md", "wiki")
	target := seedPGDoc(t, db, "", "arc-target.md", "/wiki", "wiki/arc-target.md", "wiki")

	if err := db.StoreChunks(source.ID, []store.Chunk{
		{ChunkIndex: 0, Content: "some chunk", TokenCount: 2},
	}); err != nil {
		t.Fatalf("StoreChunks: %v", err)
	}
	if err := db.UpsertReference(source.ID, target.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference: %v", err)
	}

	if _, err := db.ArchiveDocuments([]string{source.ID}); err != nil {
		t.Fatalf("ArchiveDocuments: %v", err)
	}
	if n := countChunks(t, db, source.ID); n != 0 {
		t.Errorf("chunk count after archive = %d, want 0", n)
	}
	if n := countRefs(t, db, source.ID); n != 0 {
		t.Errorf("ref count after archive = %d, want 0", n)
	}

	backlinks, err := db.GetBacklinks(target.ID)
	if err != nil {
		t.Fatalf("GetBacklinks: %v", err)
	}
	if len(backlinks) != 0 {
		t.Errorf("backlinks after archive = %+v, want none", backlinks)
	}
}
