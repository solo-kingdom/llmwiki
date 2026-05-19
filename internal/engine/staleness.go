package engine

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
	// ListAllDocuments returns all documents for index building.
	ListAllDocuments() ([]DocEntry, error)
	// ListWikiDocuments returns wiki documents with content for reference rebuilding.
	ListWikiDocuments() ([]DocEntry, error)
	// StoreChunks replaces all chunks for a document.
	StoreChunks(docID string, chunks []ChunkData) error
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

// NewStalenessPropagator creates a new staleness propagator.
func NewStalenessPropagator(store Store) *StalenessPropagator {
	return &StalenessPropagator{store: store}
}

// PropagateAfterWrite updates staleness for all pages linking to the given doc.
// Should be called after a wiki page is created or updated.
func (sp *StalenessPropagator) PropagateAfterWrite(docID string) error {
	return sp.store.PropagateStaleness(docID)
}

// SyncReferencesAfterWrite re-parses the content and updates the reference graph.
func (sp *StalenessPropagator) SyncReferencesAfterWrite(docID, content, docPath string) error {
	// Delete old references
	if err := sp.store.DeleteReferences(docID); err != nil {
		return err
	}

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

	// Insert new references
	for _, ref := range refs {
		if err := sp.store.UpsertReference(docID, ref.TargetPath, ref.RefType, ref.Page); err != nil {
			return err
		}
	}

	return nil
}

// GetBacklinkSummary returns a summary of backlinks for display.
func (sp *StalenessPropagator) GetBacklinkSummary(docID string) ([]BacklinkInfo, error) {
	return sp.store.GetBacklinks(docID)
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
