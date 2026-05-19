package engine

import (
	"crypto/sha256"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// Reindexer rebuilds the entire SQLite index from filesystem files.
type Reindexer struct {
	store      Store
	workspace  string
	ignoreDirs map[string]bool
}

// NewReindexer creates a new reindexer.
func NewReindexer(store Store, workspace string) *Reindexer {
	return &Reindexer{
		store:      store,
		workspace:  workspace,
		ignoreDirs: map[string]bool{
			".llmwiki": true,
			".git":     true,
			"node_modules": true,
			"__pycache__":  true,
			".venv":    true,
			"venv":     true,
		},
	}
}

// Rebuild performs a full reindex of all files in the workspace.
func (r *Reindexer) Rebuild(userID string) (int, error) {
	// Walk all files
	var files []string
	err := filepath.Walk(r.workspace, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		// Skip directories
		if info.IsDir() {
			name := info.Name()
			if name == "" {
				return nil
			}
			// Skip ignored directories and hidden dirs
			if r.ignoreDirs[name] || strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		// Skip hidden files
		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		rel, err := filepath.Rel(r.workspace, path)
		if err != nil {
			return nil
		}
		files = append(files, rel)
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("walk workspace: %w", err)
	}

	indexed := 0
	for _, rel := range files {
		fullPath := filepath.Join(r.workspace, rel)
		if err := r.indexFile(userID, rel, fullPath); err != nil {
			log.Printf("Warning: failed to index %s: %v", rel, err)
			continue
		}
		indexed++
	}

	// After indexing all files, rebuild reference graph
	if err := r.rebuildReferences(); err != nil {
		log.Printf("Warning: failed to rebuild references: %v", err)
	}

	return indexed, nil
}

func (r *Reindexer) indexFile(userID, relPath, fullPath string) error {
	info, err := os.Stat(fullPath)
	if err != nil {
		return err
	}

	// Determine dir path and filename
	dir := "/"
	filename := relPath
	if idx := strings.LastIndex(relPath, "/"); idx >= 0 {
		dir = "/" + relPath[:idx] + "/"
		filename = relPath[idx+1:]
	}

	// Determine source kind
	sourceKind := "source"
	if strings.HasPrefix(relPath, "wiki/") {
		sourceKind = "wiki"
	}

	// Determine file type
	ext := ""
	if idx := strings.LastIndex(filename, "."); idx >= 0 {
		ext = strings.ToLower(filename[idx+1:])
	}

	// Derive title from filename
	title := TitleFromFilename(filename)

	// Read content for text files
	content := ""
	contentHash := ""
	textTypes := map[string]bool{
		"md": true, "txt": true, "csv": true, "html": true,
		"svg": true, "json": true, "xml": true,
	}

	if textTypes[ext] {
		data, err := os.ReadFile(fullPath)
		if err == nil {
			content = string(data)
			// Compute hash
			h := sha256.Sum256(data)
			contentHash = fmt.Sprintf("%x", h)
		}
	}

	// Parse frontmatter for wiki pages
	tags := []string{}
	date := ""
	metadata := ""
	if sourceKind == "wiki" && ext == "md" {
		fm := ParseFrontmatter(content)
		tags = fm.Tags
		date = fm.Date
		metadata = fm.GetMetadataJSON()
		// Use frontmatter title if available
		if fm.Title != "" {
			title = fm.Title
		}
	}

	doc := &DocData{
		Filename:    filename,
		Title:       title,
		Path:        dir,
		Content:     content,
		SourceKind:  sourceKind,
		FileType:    ext,
		FileSize:    info.Size(),
		Status:      "ready",
		Tags:        tags,
		Date:        date,
		Metadata:    metadata,
		ContentHash: contentHash,
	}

	if err := r.store.CreateDocument(doc); err != nil {
		return fmt.Errorf("create document: %w", err)
	}

	return nil
}

func (r *Reindexer) rebuildReferences() error {
	wikiDocs, err := r.store.ListWikiDocuments()
	if err != nil {
		return err
	}

	allDocs, err := r.store.ListAllDocuments()
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
	rp := NewReferenceParser(entries)

	for _, doc := range wikiDocs {
		// Clear old references
		if err := r.store.DeleteReferences(doc.ID); err != nil {
			return err
		}

		// Parse and insert new references
		docPath := doc.Path + doc.Filename
		refs := rp.ParseReferences(doc.Content, docPath)
		for _, ref := range refs {
			if err := r.store.UpsertReference(doc.ID, ref.TargetPath, ref.RefType, ref.Page); err != nil {
				return err
			}
		}
	}

	return nil
}
