package sqlite

import (
	"testing"
)

func TestReferenceReindexRecovery(t *testing.T) {
	db := helperDB(t)

	wikiDoc := &Document{
		UserID:       "test-user",
		Filename:     "overview.md",
		Title:        "Overview",
		Path:         "/wiki",
		RelativePath: "wiki/overview.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
		Content:      "See [Details](details.md) for more.\n\n[^1]: paper.pdf, p.3",
	}
	if err := db.CreateDocument(wikiDoc); err != nil {
		t.Fatalf("CreateDocument wiki: %v", err)
	}

	detailsDoc := &Document{
		UserID:       "test-user",
		Filename:     "details.md",
		Title:        "Details",
		Path:         "/wiki",
		RelativePath: "wiki/details.md",
		SourceKind:   "wiki",
		FileType:     "md",
		Status:       "ready",
	}
	if err := db.CreateDocument(detailsDoc); err != nil {
		t.Fatalf("CreateDocument details: %v", err)
	}

	sourceDoc := &Document{
		UserID:       "test-user",
		Filename:     "paper.pdf",
		Title:        "Paper",
		Path:         "/sources",
		RelativePath: "sources/paper.pdf",
		SourceKind:   "source",
		FileType:     "pdf",
		Status:       "ready",
	}
	if err := db.CreateDocument(sourceDoc); err != nil {
		t.Fatalf("CreateDocument source: %v", err)
	}

	if err := db.UpsertReference(wikiDoc.ID, detailsDoc.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference links_to: %v", err)
	}
	page := 3
	if err := db.UpsertReference(wikiDoc.ID, sourceDoc.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference cites: %v", err)
	}

	fwdRefs, err := db.GetForwardReferences(wikiDoc.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences() before reindex: %v", err)
	}
	if len(fwdRefs) == 0 {
		t.Fatal("expected forward references before reindex, got none")
	}
	origCount := len(fwdRefs)

	if err := db.DeleteReferences(wikiDoc.ID); err != nil {
		t.Fatalf("DeleteReferences() error = %v", err)
	}

	fwdRefsAfterDelete, err := db.GetForwardReferences(wikiDoc.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences() after delete: %v", err)
	}
	if len(fwdRefsAfterDelete) != 0 {
		t.Fatalf("expected 0 forward refs after delete, got %d", len(fwdRefsAfterDelete))
	}

	if err := db.UpsertReference(wikiDoc.ID, detailsDoc.ID, "links_to", nil); err != nil {
		t.Fatalf("reindex UpsertReference links_to: %v", err)
	}
	if err := db.UpsertReference(wikiDoc.ID, sourceDoc.ID, "cites", &page); err != nil {
		t.Fatalf("reindex UpsertReference cites: %v", err)
	}

	fwdRefsAfterReindex, err := db.GetForwardReferences(wikiDoc.ID)
	if err != nil {
		t.Fatalf("GetForwardReferences() after reindex: %v", err)
	}
	if len(fwdRefsAfterReindex) != origCount {
		t.Errorf("expected %d refs after reindex (same as original), got %d", origCount, len(fwdRefsAfterReindex))
	}
}

func TestReindexRestoresAllReferences(t *testing.T) {
	db := helperDB(t)

	docs := []struct {
		filename, path, relPath, kind, content string
	}{
		{"page1.md", "/wiki", "wiki/page1.md", "wiki", "Content linking to page2 and paper"},
		{"page2.md", "/wiki", "wiki/page2.md", "wiki", "Another page with link to page1"},
		{"source.pdf", "/sources", "sources/source.pdf", "source", ""},
	}

	created := make(map[string]*Document)
	for _, d := range docs {
		doc := &Document{
			UserID:       "test-user",
			Filename:     d.filename,
			Title:        d.filename,
			Path:         d.path,
			RelativePath: d.relPath,
			SourceKind:   d.kind,
			FileType:     "md",
			Status:       "ready",
			Content:      d.content,
		}
		if err := db.CreateDocument(doc); err != nil {
			t.Fatalf("CreateDocument(%s): %v", d.filename, err)
		}
		created[d.filename] = doc
	}

	p1 := created["page1.md"]
	p2 := created["page2.md"]
	sp := created["source.pdf"]

	if err := db.UpsertReference(p1.ID, p2.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference p1->p2: %v", err)
	}
	page := 1
	if err := db.UpsertReference(p1.ID, sp.ID, "cites", &page); err != nil {
		t.Fatalf("UpsertReference p1->sp: %v", err)
	}
	if err := db.UpsertReference(p2.ID, p1.ID, "links_to", nil); err != nil {
		t.Fatalf("UpsertReference p2->p1: %v", err)
	}

	totalRefs := 0
	for _, doc := range created {
		refs, err := db.GetForwardReferences(doc.ID)
		if err != nil {
			t.Fatalf("GetForwardReferences(%s): %v", doc.Filename, err)
		}
		totalRefs += len(refs)
	}
	if totalRefs == 0 {
		t.Fatal("expected some references before reindex")
	}

	for _, doc := range created {
		db.DeleteReferences(doc.ID)
	}

	if err := db.UpsertReference(p1.ID, p2.ID, "links_to", nil); err != nil {
		t.Fatalf("reindex UpsertReference p1->p2: %v", err)
	}
	if err := db.UpsertReference(p1.ID, sp.ID, "cites", &page); err != nil {
		t.Fatalf("reindex UpsertReference p1->sp: %v", err)
	}
	if err := db.UpsertReference(p2.ID, p1.ID, "links_to", nil); err != nil {
		t.Fatalf("reindex UpsertReference p2->p1: %v", err)
	}

	recoveredRefs := 0
	for _, doc := range created {
		refs, err := db.GetForwardReferences(doc.ID)
		if err != nil {
			t.Fatalf("reindex GetForwardReferences(%s): %v", doc.Filename, err)
		}
		recoveredRefs += len(refs)
	}
	if recoveredRefs != totalRefs {
		t.Errorf("expected %d refs after full reindex, got %d", totalRefs, recoveredRefs)
	}
}
