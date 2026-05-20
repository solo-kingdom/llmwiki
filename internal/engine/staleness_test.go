package engine

import (
	"testing"
)

// mockStore implements Store for testing.
type mockStore struct {
	propagatedIDs []string
	backlinks     []BacklinkInfo
	allDocs       []DocEntry
	wikiDocs      []DocEntry
	refs          []struct {
		src, tgt, typ string
		page          *int
	}
	deletedRefs []string
}

func (m *mockStore) PropagateStaleness(docID string) error {
	m.propagatedIDs = append(m.propagatedIDs, docID)
	return nil
}

func (m *mockStore) GetBacklinks(docID string) ([]BacklinkInfo, error) {
	return m.backlinks, nil
}

func (m *mockStore) CreateDocument(doc *DocData) error {
	return nil
}

func (m *mockStore) UpdateDocument(id, content, title string, tags []string, date, metadata string) error {
	return nil
}

func (m *mockStore) GetDocumentByPath(filename, dirPath string) (*DocData, error) {
	return nil, nil
}

func (m *mockStore) DeleteReferences(sourceDocID string) error {
	m.deletedRefs = append(m.deletedRefs, sourceDocID)
	return nil
}

func (m *mockStore) UpsertReference(sourceID, targetID, refType string, page *int) error {
	m.refs = append(m.refs, struct {
		src, tgt, typ string
		page          *int
	}{sourceID, targetID, refType, page})
	return nil
}

func (m *mockStore) ListAllDocuments() ([]DocEntry, error) {
	return m.allDocs, nil
}

func (m *mockStore) ListWikiDocuments() ([]DocEntry, error) {
	return m.wikiDocs, nil
}

func (m *mockStore) StoreChunks(docID string, chunks []ChunkData) error {
	return nil
}

func (m *mockStore) DeleteChunks(docID string) error {
	return nil
}

func (m *mockStore) ReplaceReferencesInTx(sourceDocID string, edges []RefEdge) error {
	m.deletedRefs = append(m.deletedRefs, sourceDocID)
	for _, e := range edges {
		m.refs = append(m.refs, struct {
			src, tgt, typ string
			page          *int
		}{e.SourceID, e.TargetID, e.RefType, e.Page})
	}
	return nil
}

func TestPropagateAfterWrite(t *testing.T) {
	store := &mockStore{}
	sp := NewStalenessPropagator(store)

	if err := sp.PropagateAfterWrite("doc-123"); err != nil {
		t.Fatalf("PropagateAfterWrite() error = %v", err)
	}
	if len(store.propagatedIDs) != 1 || store.propagatedIDs[0] != "doc-123" {
		t.Errorf("expected propagation for doc-123, got %v", store.propagatedIDs)
	}
}

func TestSyncReferencesAfterWrite(t *testing.T) {
	store := &mockStore{
		allDocs: []DocEntry{
			{ID: "target1", Filename: "target.md", Path: "/wiki/concepts"},
		},
	}
	sp := NewStalenessPropagator(store)

	content := `See [Target](target.md) for details.
[^1]: some-file.pdf, p.3`

	err := sp.SyncReferencesAfterWrite("source1", content, "/wiki/test.md")
	if err != nil {
		t.Fatalf("SyncReferencesAfterWrite() error = %v", err)
	}

	// Should have deleted old refs
	if len(store.deletedRefs) != 1 || store.deletedRefs[0] != "source1" {
		t.Errorf("expected DeleteReferences for source1, got %v", store.deletedRefs)
	}

	// Should have upserted new refs
	if len(store.refs) == 0 {
		t.Error("expected upserted references, got none")
	}

	// At least one should be links_to for the wiki link
	hasLinksTo := false
	for _, r := range store.refs {
		if r.typ == "links_to" {
			hasLinksTo = true
			break
		}
	}
	if !hasLinksTo {
		t.Error("expected at least one links_to reference")
	}
}

func TestGetBacklinkSummary(t *testing.T) {
	store := &mockStore{
		backlinks: []BacklinkInfo{
			{Path: "/wiki/a.md", Filename: "a.md", Title: "Page A", ReferenceType: "links_to"},
			{Path: "/wiki/b.md", Filename: "b.md", Title: "Page B", ReferenceType: "cites"},
		},
	}
	sp := NewStalenessPropagator(store)

	summary, err := sp.GetBacklinkSummary("doc-x")
	if err != nil {
		t.Fatalf("GetBacklinkSummary() error = %v", err)
	}
	if len(summary) != 2 {
		t.Fatalf("expected 2 backlinks, got %d", len(summary))
	}
	if summary[0].Filename != "a.md" {
		t.Errorf("expected first backlink 'a.md', got %q", summary[0].Filename)
	}
}

func TestBuildReferenceIndex(t *testing.T) {
	docs := []DocEntry{
		{ID: "id1", Filename: "page1.md", Title: "Page One", Path: "/wiki"},
		{ID: "id2", Filename: "page2.md", Title: "Page Two", Path: "/wiki"},
	}

	rp := BuildReferenceIndex(docs)
	if rp == nil {
		t.Fatal("BuildReferenceIndex returned nil")
	}

	// Should be able to resolve page1
	id := rp.resolveFilename("page1.md")
	if id != "id1" {
		t.Errorf("resolveFilename('page1.md') = %q, want 'id1'", id)
	}
}
