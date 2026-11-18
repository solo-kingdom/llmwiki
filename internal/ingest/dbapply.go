package ingest

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// applyBlocks dispatches to the DB-first apply path when enabled.
func (p *Pipeline) applyBlocks(ctx context.Context, blocks map[string]string) (ApplyWikiResult, error) {
	if !p.applyToDB || p.db == nil {
		return ApplyWikiBlocks(ctx, p.effectiveWorkspace(), blocks, p.applyWikiBlocksOpts())
	}
	return p.applyBlocksToStore(ctx, blocks)
}

// applyBlocksToStore keeps merge protection file-based by hydrating current page
// content into a scratch directory, then persists the resulting pages as one
// change set in PostgreSQL.
func (p *Pipeline) applyBlocksToStore(ctx context.Context, blocks map[string]string) (ApplyWikiResult, error) {
	normalized, adjustments, err := normalizeWikiFileBlocks(blocks)
	if err != nil {
		return ApplyWikiResult{}, err
	}
	if len(adjustments) > 0 && p.recorder != nil {
		p.recorder.Record("apply_files", "warn", "normalized FILE paths", map[string]any{"adjustments": adjustments})
	}

	scratch, err := os.MkdirTemp("", "llmwiki-apply-")
	if err != nil {
		return ApplyWikiResult{}, fmt.Errorf("create scratch dir: %w", err)
	}
	defer os.RemoveAll(scratch)

	for rel := range normalized {
		doc, lookupErr := p.db.GetDocumentByRelativePath(rel)
		if lookupErr != nil {
			return ApplyWikiResult{}, fmt.Errorf("load current page %s: %w", rel, lookupErr)
		}
		if doc == nil {
			continue
		}
		full := filepath.Join(scratch, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return ApplyWikiResult{}, err
		}
		if err := os.WriteFile(full, []byte(doc.Content), 0o644); err != nil {
			return ApplyWikiResult{}, fmt.Errorf("hydrate %s: %w", rel, err)
		}
	}

	result, err := ApplyWikiBlocks(ctx, scratch, normalized, p.applyWikiBlocksOpts())
	if err != nil {
		return ApplyWikiResult{}, err
	}
	if len(result.Written) == 0 && len(result.Deleted) == 0 {
		return result, nil
	}

	cs := &store.ChangeSet{
		Kind:              p.changeSetKind,
		JobID:             p.changeSetJobID,
		ReviewID:          p.changeSetReviewID,
		SourceFilename:    p.sourceFilename,
		NormalizedContent: p.normalizedContent,
		Summary:           fmt.Sprintf("apply %d page(s)", len(result.Written)),
	}
	writes := make([]store.PageWrite, 0, len(result.Written)+len(result.Deleted))
	for _, rel := range result.Written {
		data, readErr := os.ReadFile(filepath.Join(scratch, rel))
		if readErr != nil {
			return ApplyWikiResult{}, fmt.Errorf("read applied page %s: %w", rel, readErr)
		}
		doc, err := pageDocument(p.db, rel, data)
		if err != nil {
			return ApplyWikiResult{}, err
		}
		op := store.RevisionCreate
		if existing, _ := p.db.GetDocumentByRelativePath(rel); existing != nil {
			op = store.RevisionUpdate
		}
		writes = append(writes, store.PageWrite{
			Document:  doc,
			Operation: op,
			Chunks:    pageChunks(doc.ID, string(data)),
		})
	}
	for _, rel := range result.Deleted {
		writes = append(writes, store.PageWrite{RelativePath: rel, Operation: store.RevisionDelete})
	}
	if err := p.db.ApplyChangeSet(cs, writes); err != nil {
		return ApplyWikiResult{}, fmt.Errorf("persist pages: %w", err)
	}
	p.lastChangeSetID = cs.ID
	if err := rebuildReferences(p.db, result.Written); err != nil && p.recorder != nil {
		p.recorder.Record("apply_files", "warn", "rebuild references: "+err.Error(), nil)
	}
	return result, nil
}

func pageDocument(db store.Store, rel string, data []byte) (*store.Document, error) {
	filename := filepath.Base(rel)
	dir := "/" + strings.TrimSuffix(strings.TrimPrefix(filepath.Dir(rel), "./"), "/") + "/"
	if dir == "//" || dir == "/./" {
		dir = "/"
	}
	fm := engine.ParseFrontmatter(string(data))
	title := fm.Title
	if title == "" {
		title = engine.TitleFromFilename(filename)
	}
	sum := sha256.Sum256(data)
	doc := &store.Document{
		Filename:     filename,
		Title:        title,
		Path:         dir,
		RelativePath: rel,
		SourceKind:   "wiki",
		FileType:     "md",
		FileSize:     int64(len(data)),
		Status:       "ready",
		Content:      string(data),
		Tags:         fm.Tags,
		Date:         fm.GetDate(),
		Metadata:     fm.GetMetadataJSON(),
		ContentHash:  fmt.Sprintf("%x", sum),
	}
	if existing, err := db.GetDocumentByRelativePath(rel); err == nil && existing != nil {
		doc.ID = existing.ID
		doc.DocumentNumber = existing.DocumentNumber
	}
	return doc, nil
}

func pageChunks(docID, content string) []store.Chunk {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	cfg := engine.DefaultChunkConfig()
	chunks := engine.ChunkText(content, 1, cfg)
	out := make([]store.Chunk, len(chunks))
	for i, c := range chunks {
		out[i] = store.Chunk{
			DocumentID:       docID,
			ChunkIndex:       c.Index,
			Content:          c.Content,
			Page:             c.Page,
			StartChar:        c.StartChar,
			TokenCount:       c.TokenCount,
			HeaderBreadcrumb: c.HeaderBreadcrumb,
		}
	}
	return out
}

// rebuildReferences reparses links/citations for the given pages against the
// current document index.
func rebuildReferences(db store.Store, relPaths []string) error {
	if len(relPaths) == 0 {
		return nil
	}
	docs, err := db.ListDocuments()
	if err != nil {
		return err
	}
	entries := make([]engine.DocIndexEntry, len(docs))
	for i, d := range docs {
		entries[i] = engine.DocIndexEntry{ID: d.ID, Filename: d.Filename, Title: d.Title, Path: d.Path}
	}
	rp := engine.NewReferenceParser(entries)
	for _, rel := range relPaths {
		doc, err := db.GetDocumentByRelativePath(rel)
		if err != nil {
			return err
		}
		if doc == nil {
			continue
		}
		refs := rp.ParseReferences(doc.Content, doc.Path+doc.Filename)
		edges := make([]store.RefEdge, 0, len(refs))
		for _, ref := range refs {
			edges = append(edges, store.RefEdge{
				SourceID: doc.ID,
				TargetID: ref.TargetPath,
				RefType:  ref.RefType,
				Page:     ref.Page,
			})
		}
		if err := db.ReplaceReferencesInTx(doc.ID, edges); err != nil {
			return err
		}
	}
	return nil
}

// BuildPageChunks chunks page content into store chunk rows.
func BuildPageChunks(docID, content string) []store.Chunk {
	return pageChunks(docID, content)
}

// RebuildReferences reparses links/citations for the given pages.
func RebuildReferences(db store.Store, relPaths []string) error {
	return rebuildReferences(db, relPaths)
}
