package service

import (
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type StoreAdapter struct {
	db *sqlite.DB
}

func NewStoreAdapter(db *sqlite.DB) *StoreAdapter {
	return &StoreAdapter{db: db}
}

func (a *StoreAdapter) CreateDocument(doc *engine.DocData) error {
	relPath := strings.TrimPrefix(doc.Path, "/") + doc.Filename
	sqliteDoc := &sqlite.Document{
		ID:           doc.ID,
		UserID:       "default",
		Filename:     doc.Filename,
		Title:        doc.Title,
		Path:         doc.Path,
		RelativePath: relPath,
		SourceKind:   doc.SourceKind,
		FileType:     doc.FileType,
		FileSize:     doc.FileSize,
		Status:       doc.Status,
		Content:      doc.Content,
		Tags:         doc.Tags,
		Date:         doc.Date,
		Metadata:     doc.Metadata,
		ContentHash:  doc.ContentHash,
	}
	if err := a.db.CreateDocument(sqliteDoc); err != nil {
		return err
	}
	doc.ID = sqliteDoc.ID
	return nil
}

func (a *StoreAdapter) ListAllDocuments() ([]engine.DocEntry, error) {
	docs, err := a.db.ListDocuments()
	if err != nil {
		return nil, err
	}
	entries := make([]engine.DocEntry, len(docs))
	for i, d := range docs {
		entries[i] = engine.DocEntry{
			ID:       d.ID,
			Filename: d.Filename,
			Title:    d.Title,
			Path:     d.Path,
		}
	}
	return entries, nil
}

func (a *StoreAdapter) ListWikiDocuments() ([]engine.DocEntry, error) {
	docs, err := a.db.ListDocumentsWithContent()
	if err != nil {
		return nil, err
	}
	var entries []engine.DocEntry
	for _, d := range docs {
		if d.SourceKind == "wiki" {
			entries = append(entries, engine.DocEntry{
				ID:       d.ID,
				Filename: d.Filename,
				Title:    d.Title,
				Path:     d.Path,
				Content:  d.Content,
			})
		}
	}
	return entries, nil
}

func (a *StoreAdapter) GetDocumentByPath(filename, dirPath string) (*engine.DocData, error) {
	doc, err := a.db.GetDocumentByPath(filename, dirPath)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, nil
	}
	return &engine.DocData{
		ID:         doc.ID,
		Filename:   doc.Filename,
		Title:      doc.Title,
		Path:       doc.Path,
		Content:    doc.Content,
		SourceKind: doc.SourceKind,
		FileType:   doc.FileType,
		FileSize:   doc.FileSize,
		Status:     doc.Status,
		Tags:       doc.Tags,
		Date:       doc.Date,
		Metadata:   doc.Metadata,
	}, nil
}

func (a *StoreAdapter) GetBacklinks(docID string) ([]engine.BacklinkInfo, error) {
	refs, err := a.db.GetBacklinks(docID)
	if err != nil {
		return nil, err
	}
	result := make([]engine.BacklinkInfo, len(refs))
	for i, r := range refs {
		result[i] = engine.BacklinkInfo{
			Path:          r.Path,
			Filename:      r.Filename,
			Title:         r.Title,
			ReferenceType: r.ReferenceType,
		}
	}
	return result, nil
}

func (a *StoreAdapter) DeleteChunks(docID string) error {
	return a.db.DeleteChunks(docID)
}

func (a *StoreAdapter) ArchiveDocument(docID string) error {
	_, err := a.db.ArchiveDocuments([]string{docID})
	return err
}

func (a *StoreAdapter) StoreChunks(docID string, chunks []engine.ChunkData) error {
	sqliteChunks := make([]sqlite.Chunk, len(chunks))
	for i, c := range chunks {
		sqliteChunks[i] = sqlite.Chunk{
			DocumentID:      c.DocumentID,
			ChunkIndex:      c.ChunkIndex,
			Content:         c.Content,
			Page:            c.Page,
			StartChar:       c.StartChar,
			TokenCount:      c.TokenCount,
			HeaderBreadcrumb: c.HeaderBreadcrumb,
		}
	}
	return a.db.StoreChunks(docID, sqliteChunks)
}

func (a *StoreAdapter) ReplaceReferencesInTx(sourceDocID string, edges []engine.RefEdge) error {
	sqliteEdges := make([]sqlite.RefEdge, len(edges))
	for i, e := range edges {
		sqliteEdges[i] = sqlite.RefEdge{
			SourceID: e.SourceID,
			TargetID: e.TargetID,
			RefType:  e.RefType,
			Page:     e.Page,
		}
	}
	return a.db.ReplaceReferencesInTx(sourceDocID, sqliteEdges)
}

func (a *StoreAdapter) UpsertReference(sourceID, targetID, refType string, page *int) error {
	return a.db.UpsertReference(sourceID, targetID, refType, page)
}

func (a *StoreAdapter) DeleteReferences(sourceDocID string) error {
	return a.db.DeleteReferences(sourceDocID)
}

func (a *StoreAdapter) PropagateStaleness(docID string) error {
	return a.db.PropagateStaleness(docID)
}

func (a *StoreAdapter) UpdateDocument(id, content, title string, tags []string, date, metadata string) error {
	return a.db.UpdateDocument(id, content, title, tags, date, metadata)
}
