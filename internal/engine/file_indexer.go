package engine

import (
	"log"
	"strings"
)

// WorkspaceFileIndexer adapts Reindexer for the file watcher Indexer interface.
type WorkspaceFileIndexer struct {
	reindexer *Reindexer
	store     Store
	staleness *StalenessPropagator
}

// NewWorkspaceFileIndexer creates an indexer for watcher and ingest hooks.
func NewWorkspaceFileIndexer(store Store, workspace string) *WorkspaceFileIndexer {
	return &WorkspaceFileIndexer{
		reindexer: NewReindexer(store, workspace),
		store:     store,
		staleness: NewStalenessPropagator(store),
	}
}

func (w *WorkspaceFileIndexer) IndexFile(relPath string) error {
	relPath = filepathToSlash(relPath)
	if !isIndexableRelPath(relPath) {
		return nil
	}
	docID, err := w.reindexer.IndexRelPath(relPath)
	if err != nil {
		return err
	}

	// Sync reference graph for wiki files only
	if strings.HasPrefix(relPath, "wiki/") {
		w.syncReferences(docID, relPath)
	}

	return nil
}

// syncReferences updates the reference graph for a wiki document after write.
// Errors are logged but do not block the main indexing flow.
func (w *WorkspaceFileIndexer) syncReferences(docID, relPath string) {
	if docID == "" || w.staleness == nil {
		return
	}

	// Look up the document to get content
	dir := "/"
	filename := relPath
	if idx := strings.LastIndex(relPath, "/"); idx >= 0 {
		dir = "/" + relPath[:idx] + "/"
		filename = relPath[idx+1:]
	}

	doc, err := w.store.GetDocumentByPath(filename, dir)
	if err != nil || doc == nil {
		log.Printf("Warning: failed to get document for reference sync %s: %v", relPath, err)
		return
	}

	if err := w.staleness.SyncReferencesAfterWrite(docID, doc.Content, relPath); err != nil {
		log.Printf("Warning: failed to sync references for %s: %v", relPath, err)
	}
}

func (w *WorkspaceFileIndexer) UpdateFile(relPath string) error {
	return w.IndexFile(relPath)
}

// IndexDocumentContent indexes document body text without reading from disk.
func (w *WorkspaceFileIndexer) IndexDocumentContent(docID, content string) error {
	return IndexDocumentContent(w.store, docID, content)
}

func (w *WorkspaceFileIndexer) RemoveFile(relPath string) error {
	relPath = filepathToSlash(relPath)
	dir := "/"
	filename := relPath
	if idx := strings.LastIndex(relPath, "/"); idx >= 0 {
		dir = "/" + relPath[:idx] + "/"
		filename = relPath[idx+1:]
	}
	doc, err := w.store.GetDocumentByPath(filename, dir)
	if err != nil || doc == nil {
		return err
	}
	return w.store.DeleteChunks(doc.ID)
}

func filepathToSlash(p string) string {
	return strings.ReplaceAll(p, "\\", "/")
}

func isIndexableRelPath(relPath string) bool {
	if relPath == "" || strings.HasPrefix(relPath, ".") {
		return false
	}
	return strings.HasPrefix(relPath, "raw/") || strings.HasPrefix(relPath, "wiki/")
}
