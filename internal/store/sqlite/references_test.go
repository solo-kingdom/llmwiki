package sqlite

import (
	"testing"
)

func TestUpsertReference(t *testing.T) {
	db := helperDB(t)

	source := createTestDoc(t, db, "source.md", "/wiki", "wiki/source.md")
	target := createTestDoc(t, db, "target.md", "/wiki", "wiki/target.md")

	page := 3
	if err := db.UpsertReference(source.ID, target.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	// Verify
	var count int
	err := db.DB().QueryRow("SELECT COUNT(*) FROM document_references WHERE source_document_id = ?", source.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count query error = %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 reference, got %d", count)
	}
}

func TestUpsertReferenceIdempotent(t *testing.T) {
	db := helperDB(t)

	source := createTestDoc(t, db, "idem-source.md", "/wiki", "wiki/idem-source.md")
	target := createTestDoc(t, db, "idem-target.md", "/wiki", "wiki/idem-target.md")

	page := 1
	// Insert twice with same unique key
	if err := db.UpsertReference(source.ID, target.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference() first error = %v", err)
	}
	page2 := 2
	if err := db.UpsertReference(source.ID, target.ID, "cites", &page2); err != nil {
		t.Fatalf("UpsertReference() second error = %v", err)
	}

	// Should only have 1 row (upsert)
	var count int
	err := db.DB().QueryRow("SELECT COUNT(*) FROM document_references WHERE source_document_id = ?", source.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count query error = %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 reference after upsert, got %d", count)
	}

	// Page should be updated
	var gotPage int
	err = db.DB().QueryRow("SELECT page FROM document_references WHERE source_document_id = ? AND target_document_id = ?",
		source.ID, target.ID).Scan(&gotPage)
	if err != nil {
		t.Fatalf("page query error = %v", err)
	}
	if gotPage != 2 {
		t.Errorf("expected page=2 after upsert, got %d", gotPage)
	}
}

func TestUpsertDifferentTypes(t *testing.T) {
	db := helperDB(t)

	source := createTestDoc(t, db, "multiref-source.md", "/wiki", "wiki/multiref-source.md")
	target := createTestDoc(t, db, "multiref-target.md", "/wiki", "wiki/multiref-target.md")

	// Same source+target but different reference_type should be separate rows
	page := 1
	if err := db.UpsertReference(source.ID, target.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference() cites error = %v", err)
	}
	if err := db.UpsertReference(source.ID, target.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference() links_to error = %v", err)
	}

	var count int
	err := db.DB().QueryRow("SELECT COUNT(*) FROM document_references WHERE source_document_id = ?", source.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count query error = %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 references (different types), got %d", count)
	}
}

func TestDeleteReferences(t *testing.T) {
	db := helperDB(t)

	source := createTestDoc(t, db, "delref-source.md", "/wiki", "wiki/delref-source.md")
	target := createTestDoc(t, db, "delref-target.md", "/wiki", "wiki/delref-target.md")

	if err := db.UpsertReference(source.ID, target.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	if err := db.DeleteReferences(source.ID); err != nil {
		t.Fatalf("DeleteReferences() error = %v", err)
	}

	var count int
	err := db.DB().QueryRow("SELECT COUNT(*) FROM document_references WHERE source_document_id = ?", source.ID).Scan(&count)
	if err != nil {
		t.Fatalf("count query error = %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 references after delete, got %d", count)
	}
}

func TestGetBacklinks(t *testing.T) {
	db := helperDB(t)

	// target is referenced by both source1 and source2
	target := createTestDoc(t, db, "backlink-target.md", "/wiki", "wiki/backlink-target.md")
	source1 := createTestDoc(t, db, "backlink-source1.md", "/wiki", "wiki/backlink-source1.md")
	source2 := createTestDoc(t, db, "backlink-source2.md", "/wiki", "wiki/backlink-source2.md")

	if err := db.UpsertReference(source1.ID, target.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}
	if err := db.UpsertReference(source2.ID, target.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	refs, err := db.GetBacklinks(target.ID)
	if err != nil {
		t.Fatalf("GetBacklinks() error = %v", err)
	}
	if len(refs) != 2 {
		t.Fatalf("expected 2 backlinks, got %d", len(refs))
	}

	// Verify reference types
	refTypes := map[string]string{}
	for _, r := range refs {
		refTypes[r.Filename] = r.ReferenceType
	}
	if refTypes["backlink-source1.md"] != "links_to" {
		t.Errorf("expected source1 to have links_to, got %q", refTypes["backlink-source1.md"])
	}
	if refTypes["backlink-source2.md"] != "cites" {
		t.Errorf("expected source2 to have cites, got %q", refTypes["backlink-source2.md"])
	}
}

func TestGetBacklinksEmpty(t *testing.T) {
	db := helperDB(t)

	doc := createTestDoc(t, db, "no-backlinks.md", "/wiki", "wiki/no-backlinks.md")

	refs, err := db.GetBacklinks(doc.ID)
	if err != nil {
		t.Fatalf("GetBacklinks() error = %v", err)
	}
	if len(refs) != 0 {
		t.Errorf("expected 0 backlinks, got %d", len(refs))
	}
}

func TestGetForwardReferences(t *testing.T) {
	db := helperDB(t)

	source := createTestDoc(t, db, "fwd-source.md", "/wiki", "wiki/fwd-source.md")
	target1 := createTestDoc(t, db, "fwd-target1.md", "/wiki", "wiki/fwd-target1.md")
	target2 := createTestDoc(t, db, "fwd-target2.md", "/wiki", "wiki/fwd-target2.md")

	page := 5
	if err := db.UpsertReference(source.ID, target1.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}
	if err := db.UpsertReference(source.ID, target2.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	refs, err := db.GetForwardReferences(source.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences() error = %v", err)
	}
	if len(refs) != 2 {
		t.Fatalf("expected 2 forward refs, got %d", len(refs))
	}

	// Check page was captured
	for _, r := range refs {
		if r.Filename == "fwd-target1.md" {
			if r.Page != 5 {
				t.Errorf("expected page=5 for target1, got %d", r.Page)
			}
		}
	}
}

func TestFindUncitedSources(t *testing.T) {
	db := helperDB(t)

	// Create source docs
	cited := createTestDocWithKind(t, db, "cited.pdf", "/sources", "sources/cited.pdf", "source")
	_ = createTestDocWithKind(t, db, "uncited.pdf", "/sources", "sources/uncited.pdf", "source")
	// Create wiki doc
	wiki := createTestDoc(t, db, "page.md", "/wiki", "wiki/page.md")

	// Wiki cites one source
	_ = wiki
	if err := db.UpsertReference(wiki.ID, cited.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	sources, err := db.FindUncitedSources()
	if err != nil {
		t.Fatalf("FindUncitedSources() error = %v", err)
	}
	if len(sources) != 1 {
		t.Fatalf("expected 1 uncited source, got %d", len(sources))
	}
	if sources[0].Filename != "uncited.pdf" {
		t.Errorf("expected uncited.pdf, got %q", sources[0].Filename)
	}
}

func TestFindUncitedSourcesAllCited(t *testing.T) {
	db := helperDB(t)

	source := createTestDocWithKind(t, db, "allcited.pdf", "/sources", "sources/allcited.pdf", "source")
	wiki := createTestDoc(t, db, "citer.md", "/wiki", "wiki/citer.md")

	if err := db.UpsertReference(wiki.ID, source.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	sources, err := db.FindUncitedSources()
	if err != nil {
		t.Fatalf("FindUncitedSources() error = %v", err)
	}
	if len(sources) != 0 {
		t.Errorf("expected 0 uncited sources, got %d", len(sources))
	}
}

func TestFindStalePages(t *testing.T) {
	db := helperDB(t)

	// Fresh page (no stale_since)
	createTestDoc(t, db, "fresh.md", "/wiki", "wiki/fresh.md")

	// Stale page
	stale := &Document{
		UserID:       "test-user",
		Filename:     "stale.md",
		Title:        "Stale Page",
		Path:         "/wiki",
		RelativePath: "wiki/stale.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
	}
	if err := db.CreateDocument(stale); err != nil {
		t.Fatalf("CreateDocument() error = %v", err)
	}
	// Manually set stale_since
	_, err := db.DB().Exec("UPDATE documents SET stale_since = '2024-01-01 00:00:00' WHERE id = ?", stale.ID)
	if err != nil {
		t.Fatalf("set stale_since error = %v", err)
	}

	pages, err := db.FindStalePages()
	if err != nil {
		t.Fatalf("FindStalePages() error = %v", err)
	}
	if len(pages) != 1 {
		t.Fatalf("expected 1 stale page, got %d", len(pages))
	}
	if pages[0].Filename != "stale.md" {
		t.Errorf("expected stale.md, got %q", pages[0].Filename)
	}
	if pages[0].StaleSince == "" {
		t.Error("expected non-empty StaleSince")
	}
}

func TestPropagateStaleness(t *testing.T) {
	db := helperDB(t)

	// pageA links_to pageB
	pageA := createTestDoc(t, db, "pageA.md", "/wiki", "wiki/pageA.md")
	pageB := createTestDoc(t, db, "pageB.md", "/wiki", "wiki/pageB.md")

	if err := db.UpsertReference(pageA.ID, pageB.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	// When pageB is updated, pageA should become stale
	if err := db.PropagateStaleness(pageB.ID); err != nil {
		t.Fatalf("PropagateStaleness() error = %v", err)
	}

	// Verify pageA is now stale
	got, err := db.GetDocument(pageA.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if got.StaleSince == "" {
		t.Error("expected pageA to be stale after propagation")
	}

	// pageB should not be stale (only linking pages become stale)
	gotB, err := db.GetDocument(pageB.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if gotB.StaleSince != "" {
		t.Error("pageB should not be stale (only linking pages)")
	}
}

func TestPropagateStalenessOnlyLinksTo(t *testing.T) {
	db := helperDB(t)

	// pageC cites pageD (cites, not links_to)
	pageC := createTestDoc(t, db, "pageC.md", "/wiki", "wiki/pageC.md")
	pageD := createTestDoc(t, db, "pageD.md", "/wiki", "wiki/pageD.md")

	if err := db.UpsertReference(pageC.ID, pageD.ID, "cites", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	// Propagate staleness — should NOT affect pageC (only links_to)
	if err := db.PropagateStaleness(pageD.ID); err != nil {
		t.Fatalf("PropagateStaleness() error = %v", err)
	}

	gotC, err := db.GetDocument(pageC.ID)
	if err != nil {
		t.Fatalf("GetDocument() error = %v", err)
	}
	if gotC.StaleSince != "" {
		t.Error("pageC should not be stale (cites type, not links_to)")
	}
}

func TestPropagateStalenessIdempotent(t *testing.T) {
	db := helperDB(t)

	pageX := createTestDoc(t, db, "pageX.md", "/wiki", "wiki/pageX.md")
	pageY := createTestDoc(t, db, "pageY.md", "/wiki", "wiki/pageY.md")

	if err := db.UpsertReference(pageX.ID, pageY.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	// First propagation
	if err := db.PropagateStaleness(pageY.ID); err != nil {
		t.Fatalf("PropagateStaleness() first error = %v", err)
	}

	got1, err := db.GetDocument(pageX.ID)
	if err != nil {
		t.Fatalf("GetDocument() after first propagation error = %v", err)
	}

	// Second propagation (should not change stale_since since it's already set)
	if err := db.PropagateStaleness(pageY.ID); err != nil {
		t.Fatalf("PropagateStaleness() second error = %v", err)
	}

	got2, err := db.GetDocument(pageX.ID)
	if err != nil {
		t.Fatalf("GetDocument() after second propagation error = %v", err)
	}

	// stale_since should be unchanged (WHERE stale_since IS NULL in the SQL)
	if got1.StaleSince != got2.StaleSince {
		t.Errorf("stale_since changed on second propagation: %q -> %q", got1.StaleSince, got2.StaleSince)
	}
}

func TestCascadeDelete(t *testing.T) {
	db := helperDB(t)

	source := createTestDoc(t, db, "cascade-source.md", "/wiki", "wiki/cascade-source.md")
	target := createTestDoc(t, db, "cascade-target.md", "/wiki", "wiki/cascade-target.md")

	// Create chunks and references
	if err := db.StoreChunks(source.ID, []Chunk{
		{ChunkIndex: 0, Content: "some chunk", TokenCount: 2},
	}); err != nil {
		t.Fatalf("StoreChunks() error = %v", err)
	}
	if err := db.UpsertReference(source.ID, target.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference() error = %v", err)
	}

	// Delete source document — chunks and references should cascade
	_, err := db.ArchiveDocuments([]string{source.ID})
	if err != nil {
		t.Fatalf("ArchiveDocuments() error = %v", err)
	}

	// Chunks should be gone
	var chunkCount int
	err = db.DB().QueryRow("SELECT COUNT(*) FROM document_chunks WHERE document_id = ?", source.ID).Scan(&chunkCount)
	if err != nil {
		t.Fatalf("chunk count error = %v", err)
	}
	if chunkCount != 0 {
		t.Errorf("expected 0 chunks after cascade, got %d", chunkCount)
	}

	// References should be gone
	var refCount int
	err = db.DB().QueryRow("SELECT COUNT(*) FROM document_references WHERE source_document_id = ?", source.ID).Scan(&refCount)
	if err != nil {
		t.Fatalf("ref count error = %v", err)
	}
	if refCount != 0 {
		t.Errorf("expected 0 refs after cascade, got %d", refCount)
	}
}
