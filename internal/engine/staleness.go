package engine

import "fmt"

// StalenessPropagator handles marking wiki pages as stale when their dependencies change.
type StalenessPropagator struct {
	store Store
}

// Store is the interface the engine needs from the data layer.
type Store interface {
	// PropagateStaleness marks all pages that link to the given document as stale.
	PropagateStaleness(docID string) error
	// GetBacklinks returns all documents that reference the given document.
	GetBacklinks(docID string) ([]BacklinkInfo, error)
	// CreateDocument inserts a new document.
	CreateDocument(doc *DocData) error
	// UpdateDocument updates an existing document.
	UpdateDocument(id, content, title string, tags []string, date, metadata string) error
	// GetDocumentByPath finds a document by filename and directory path.
	GetDocumentByPath(filename, dirPath string) (*DocData, error)
	// DeleteReferences removes all reference edges from a source document.
	DeleteReferences(sourceDocID string) error
	// UpsertReference adds or updates a reference edge.
	UpsertReference(sourceID, targetID, refType string, page *int) error
	// ReplaceReferencesInTx atomically replaces all references for a source document.
	ReplaceReferencesInTx(sourceDocID string, edges []RefEdge) error
	// ListAllDocuments returns all documents for index building.
	ListAllDocuments() ([]DocEntry, error)
	// ListWikiDocuments returns wiki documents with content for reference rebuilding.
	ListWikiDocuments() ([]DocEntry, error)
	// StoreChunks replaces all chunks for a document.
	StoreChunks(docID string, chunks []ChunkData) error
	// DeleteChunks removes all chunks for a document.
	DeleteChunks(docID string) error
}

// BacklinkInfo holds a backlink result.
type BacklinkInfo struct {
	Path          string
	Filename      string
	Title         string
	ReferenceType string
}

// DocEntry is a minimal document entry for reference index building.
type DocEntry struct {
	ID       string
	Filename string
	Title    string
	Path     string
	Content  string
}

// DocData holds full document data for creation/update.
type DocData struct {
	ID           string
	Filename     string
	Title        string
	Path         string
	Content      string
	SourceKind   string
	FileType     string
	FileSize     int64
	Status       string
	Tags         []string
	Date         string
	Metadata     string
	ContentHash  string
}

// ChunkData is a chunk for storage. Mirrors the sqlite.Chunk type.
type ChunkData struct {
	DocumentID      string
	ChunkIndex      int
	Content         string
	Page            int
	StartChar       int
	TokenCount      int
	HeaderBreadcrumb string
}

// RefEdge represents a reference edge for bulk operations.
type RefEdge struct {
	SourceID string
	TargetID string
	RefType  string
	Page     *int
}

// NewStalenessPropagator creates a new staleness propagator.
func NewStalenessPropagator(store Store) *StalenessPropagator {
	return &StalenessPropagator{store: store}
}

// PropagateAfterWrite updates staleness for all pages linking to the given doc.
// Should be called after a wiki page is created or updated.
func (sp *StalenessPropagator) PropagateAfterWrite(docID string) error {
	return sp.store.PropagateStaleness(docID)
}

// SyncReferencesAfterWrite re-parses the content and updates the reference graph
// atomically within a single transaction.
func (sp *StalenessPropagator) SyncReferencesAfterWrite(docID, content, docPath string) error {
	// Build parser index
	allDocs, err := sp.store.ListAllDocuments()
	if err != nil {
		return err
	}
	entries := make([]DocIndexEntry, len(allDocs))
	for i, d := range allDocs {
		entries[i] = DocIndexEntry{
			ID:       d.ID,
			Filename: d.Filename,
			Title:    d.Title,
			Path:     d.Path,
		}
	}

	// Parse references
	rp := NewReferenceParser(entries)
	refs := rp.ParseReferences(content, docPath)

	// Build edges for atomic replace
	edges := make([]RefEdge, 0, len(refs))
	for _, ref := range refs {
		edges = append(edges, RefEdge{
			SourceID: docID,
			TargetID: ref.TargetPath,
			RefType:  ref.RefType,
			Page:     ref.Page,
		})
	}

	// Atomic delete + insert in one transaction
	if err := sp.store.ReplaceReferencesInTx(docID, edges); err != nil {
		return err
	}

	return nil
}

// GetBacklinkSummary returns a summary of backlinks for display.
func (sp *StalenessPropagator) GetBacklinkSummary(docID string) ([]BacklinkInfo, error) {
	return sp.store.GetBacklinks(docID)
}

// WriteImpactReport returns the list of pages affected by writing to the given document.
// This is used to show the user which pages will be affected before confirming a write.
func (sp *StalenessPropagator) WriteImpactReport(docID string) ([]BacklinkInfo, error) {
	return sp.store.GetBacklinks(docID)
}

// BacklinkAppendix generates a formatted appendix string with backlink summaries.
// Returns a string like "\n\n---\n**Referenced by (3)**\n- [[Page A]] (links_to)\n- [[Page B]] (cites, p.5)"
func BacklinkAppendix(backlinks []BacklinkInfo) string {
	if len(backlinks) == 0 {
		return ""
	}

	result := "\n\n---\n**Referenced by (" + fmt.Sprintf("%d", len(backlinks)) + ")**\n"
	for _, bl := range backlinks {
		title := bl.Title
		if title == "" {
			title = bl.Filename
		}
		result += "- [[" + title + "]] (" + bl.ReferenceType + ")\n"
	}
	return result
}

// BuildReferenceIndex creates a ReferenceParser from the current document set.
func BuildReferenceIndex(docs []DocEntry) *ReferenceParser {
	entries := make([]DocIndexEntry, len(docs))
	for i, d := range docs {
		entries[i] = DocIndexEntry{
			ID:       d.ID,
			Filename: d.Filename,
			Title:    d.Title,
			Path:     d.Path,
		}
	}
	return NewReferenceParser(entries)
}
