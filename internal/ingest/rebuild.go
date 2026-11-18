package ingest

import (
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// RebuildDerived re-chunks every live document and rebuilds reference edges from
// PostgreSQL content. It never reads workspace files and never deletes documents.
func RebuildDerived(db store.Store) (int, error) {
	docs, err := db.ListDocumentsWithContent()
	if err != nil {
		return 0, fmt.Errorf("list documents: %w", err)
	}
	var wikiPaths []string
	for _, doc := range docs {
		if err := db.StoreChunks(doc.ID, BuildPageChunks(doc.ID, doc.Content)); err != nil {
			return 0, fmt.Errorf("store chunks for %s: %w", doc.RelativePath, err)
		}
		if doc.SourceKind == "wiki" && doc.RelativePath != "" {
			wikiPaths = append(wikiPaths, doc.RelativePath)
		}
	}
	if err := RebuildReferences(db, wikiPaths); err != nil {
		return 0, fmt.Errorf("rebuild references: %w", err)
	}
	return len(docs), nil
}
