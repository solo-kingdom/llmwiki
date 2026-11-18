package api

import (
	"crypto/sha256"
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

func contentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return fmt.Sprintf("%x", sum)
}

func (a *API) applyPageWrite(kind, summary string, doc *store.Document, op store.RevisionOperation) error {
	if doc == nil {
		return fmt.Errorf("nil document")
	}
	if doc.ContentHash == "" {
		doc.ContentHash = contentHash(doc.Content)
	}
	if doc.RelativePath == "" && doc.Filename != "" {
		doc.RelativePath = trimJoin(doc.Path, doc.Filename)
	}
	cs := &store.ChangeSet{Kind: kind, Summary: summary}
	w := store.PageWrite{
		Document:  doc,
		Operation: op,
		Chunks:    ingest.BuildPageChunks(doc.ID, doc.Content),
	}
	if err := a.db.ApplyChangeSet(cs, []store.PageWrite{w}); err != nil {
		return err
	}
	return ingest.RebuildReferences(a.db, []string{doc.RelativePath})
}

func (a *API) applyPageDelete(kind, summary, relPath string) error {
	return a.applyPageDeletes(kind, summary, []string{relPath})
}

func (a *API) applyPageDeletes(kind, summary string, relPaths []string) error {
	writes := make([]store.PageWrite, 0, len(relPaths))
	for _, rel := range relPaths {
		if rel == "" {
			continue
		}
		writes = append(writes, store.PageWrite{RelativePath: rel, Operation: store.RevisionDelete})
	}
	if len(writes) == 0 {
		return nil
	}
	cs := &store.ChangeSet{Kind: kind, Summary: summary}
	return a.db.ApplyChangeSet(cs, writes)
}

func trimJoin(dir, name string) string {
	if dir == "" || dir == "/" {
		return name
	}
	if len(dir) > 0 && dir[len(dir)-1] == '/' {
		return dir[1:] + name
	}
	return dir[1:] + "/" + name
}
