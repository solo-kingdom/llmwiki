package mcp

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func RunLocalMCP(workspace string, db *sqlite.DB) error {
	server := NewServer("LLM Wiki",
		"You are connected to an LLM Wiki workspace. Call the `guide` tool first to see available knowledge bases and learn the full workflow.",
	)

	RegisterTools(server, workspace, db, nil)

	return server.Run()
}

func RegisterTools(server *Server, workspace string, db *sqlite.DB, indexer *engine.WorkspaceFileIndexer) {
	registerTool := func(tool Tool, handler ToolHandler) {
		server.RegisterTool(tool, func(args map[string]interface{}) (string, error) {
			activity.LogMCPTool(db, tool.Name)
			return handler(args)
		})
	}

	registerTool(Tool{
		Name:        "guide",
		Description: "Get started with LLM Wiki. Call this to understand how the knowledge vault works and see your available knowledge bases.",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
			"required":   []string{},
		},
	}, func(args map[string]interface{}) (string, error) {
		var sb strings.Builder
		sb.WriteString("# LLM Wiki Guide\n\n")
		sb.WriteString("## Architecture\n\n")
		sb.WriteString("LLM Wiki is a knowledge management system that indexes documents\n")
		sb.WriteString("into a searchable SQLite-backed vault with full-text search,\n")
		sb.WriteString("automatic chunking, and reference graph tracking.\n\n")
		sb.WriteString("## Workspaces\n\n")

		wikiDir := filepath.Join(workspace, "wiki")
		sourcesDir := filepath.Join(workspace, "raw", "sources")

		if entries, err := os.ReadDir(wikiDir); err == nil {
			sb.WriteString(fmt.Sprintf("### Wiki Pages (%d files)\n", len(entries)))
			for _, e := range entries {
				if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
					sb.WriteString(fmt.Sprintf("- %s\n", e.Name()))
				}
			}
			sb.WriteString("\n")
		} else {
			sb.WriteString("### Wiki Pages\n(directory not found)\n\n")
		}

		if entries, err := os.ReadDir(sourcesDir); err == nil {
			sb.WriteString(fmt.Sprintf("### Source Documents (%d files)\n", len(entries)))
			for _, e := range entries {
				if !e.IsDir() {
					sb.WriteString(fmt.Sprintf("- %s\n", e.Name()))
				}
			}
			sb.WriteString("\n")
		} else {
			sb.WriteString("### Source Documents\n(directory not found)\n\n")
		}

		sb.WriteString("## Available Tools\n\n")
		sb.WriteString("- **search** — Full-text search across all indexed documents\n")
		sb.WriteString("- **read** — Read a document by path or ID\n")
		sb.WriteString("- **write** — Create or update a wiki page\n")
		sb.WriteString("- **delete** — Remove a document from the vault\n")
		sb.WriteString("- **ping** — Test connectivity\n")

		return sb.String(), nil
	})

	registerTool(Tool{
		Name:        "search",
		Description: "Browse or search the knowledge vault. Modes: list (browse files), search (keyword search), references (citation graph queries).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"mode":  map[string]interface{}{"type": "string", "enum": []string{"list", "search", "references"}, "default": "list"},
				"query": map[string]interface{}{"type": "string", "default": ""},
				"path":  map[string]interface{}{"type": "string", "default": "*"},
				"limit": map[string]interface{}{"type": "integer", "default": 10},
			},
			"required": []string{},
		},
	}, func(args map[string]interface{}) (string, error) {
		if db == nil {
			return "Error: database not connected", nil
		}

		mode := "list"
		if m, ok := args["mode"].(string); ok && m != "" {
			mode = m
		}

		limit := 10
		if l, ok := args["limit"].(float64); ok {
			limit = int(l)
		}

		pathFilter := ""
		if p, ok := args["path"].(string); ok {
			switch p {
			case "wiki", "wiki/":
				pathFilter = "wiki"
			case "sources", "raw/sources":
				pathFilter = "sources"
			}
		}

		switch mode {
		case "list":
			docs, err := db.ListDocuments()
			if err != nil {
				return "", fmt.Errorf("list documents: %w", err)
			}
			if len(docs) == 0 {
				return "No documents found.", nil
			}
			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Found %d documents:\n\n", len(docs)))
			for _, doc := range docs {
				title := doc.Title
				if title == "" {
					title = doc.Filename
				}
				sb.WriteString(fmt.Sprintf("- **%s** — `%s` [%s]\n", title, doc.RelativePath, doc.FileType))
			}
			return sb.String(), nil

		case "search":
			query, _ := args["query"].(string)
			if query == "" {
				return "Error: query is required for search mode", nil
			}
			results, err := db.SearchChunks(query, limit, pathFilter)
			if err != nil {
				return "", fmt.Errorf("search: %w", err)
			}
			if len(results) == 0 {
				return "No results found for: " + query, nil
			}
			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Found %d results for \"%s\":\n\n", len(results), query))
			for _, r := range results {
				title := r.Title
				if title == "" {
					title = r.Filename
				}
				sb.WriteString(fmt.Sprintf("### %s (%s) [score: %.2f]\n", title, r.Path, r.Score))
				if r.HeaderBreadcrumb != "" {
					sb.WriteString(fmt.Sprintf("Section: %s\n", r.HeaderBreadcrumb))
				}
				sb.WriteString(r.Content + "\n\n---\n\n")
			}
			return sb.String(), nil

		case "references":
			query, _ := args["query"].(string)
			if query == "" {
				return "Error: query (document ID) is required for references mode", nil
			}
			backlinks, err := db.GetBacklinks(query)
			if err != nil {
				return "", fmt.Errorf("get backlinks: %w", err)
			}
			fwd, err := db.GetForwardReferences(query)
			if err != nil {
				return "", fmt.Errorf("get forward refs: %w", err)
			}
			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Backlinks (%d):\n", len(backlinks)))
			for _, bl := range backlinks {
				sb.WriteString(fmt.Sprintf("  ← %s [%s] (%s)\n", bl.Title, bl.Path, bl.ReferenceType))
			}
			sb.WriteString(fmt.Sprintf("\nForward references (%d):\n", len(fwd)))
			for _, fr := range fwd {
				sb.WriteString(fmt.Sprintf("  → %s [%s] (%s)\n", fr.Title, fr.Path, fr.ReferenceType))
			}
			return sb.String(), nil

		default:
			return "Unknown mode: " + mode, nil
		}
	})

	registerTool(Tool{
		Name:        "read",
		Description: "Read a document from the knowledge vault. Supports markdown, PDF (by page), images, and batch glob reads.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"path":  map[string]interface{}{"type": "string", "description": "Path to the document to read"},
				"pages": map[string]interface{}{"type": "string", "description": "Page range (e.g. '1-5,10')"},
			},
			"required": []string{"path"},
		},
	}, func(args map[string]interface{}) (string, error) {
		if db == nil {
			return "Error: database not connected", nil
		}

		path, _ := args["path"].(string)
		if path == "" {
			return "Error: path is required", nil
		}

		var doc *sqlite.Document
		var err error

		doc, err = db.GetDocument(path)
		if err != nil || doc == nil {
			doc, err = db.FindDocumentByName(path)
			if err != nil {
				return "", fmt.Errorf("find document: %w", err)
			}
		}

		if doc == nil {
			return "Document not found: " + path, nil
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("# %s\n", doc.Title))
		sb.WriteString(fmt.Sprintf("Path: %s\n", doc.RelativePath))
		sb.WriteString(fmt.Sprintf("Type: %s  Status: %s  Version: %d\n\n", doc.FileType, doc.Status, doc.Version))
		if len(doc.Tags) > 0 {
			sb.WriteString(fmt.Sprintf("Tags: %s\n", strings.Join(doc.Tags, ", ")))
		}
		sb.WriteString("---\n\n")
		sb.WriteString(doc.Content)

		return sb.String(), nil
	})

	registerTool(Tool{
		Name:        "write",
		Description: "Create or edit a wiki page. Use create for new pages, edit for str_replace modification, append to add content.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"title":   map[string]interface{}{"type": "string", "description": "Page title"},
				"content": map[string]interface{}{"type": "string", "description": "Page content with YAML frontmatter"},
				"path":    map[string]interface{}{"type": "string", "description": "Target path (default /wiki/)"},
				"tags":    map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}},
			},
			"required": []string{"title", "content"},
		},
	}, func(args map[string]interface{}) (string, error) {
		if db == nil {
			return "Error: database not connected", nil
		}

		title, _ := args["title"].(string)
		content, _ := args["content"].(string)
		dirPath := "/wiki/"
		if p, ok := args["path"].(string); ok && p != "" {
			if !strings.HasPrefix(p, "/") {
				p = "/" + p
			}
			if !strings.HasSuffix(p, "/") {
				p += "/"
			}
			dirPath = p
		}

		var tags []string
		if t, ok := args["tags"].([]interface{}); ok {
			for _, v := range t {
				if s, ok := v.(string); ok {
					tags = append(tags, s)
				}
			}
		}

		filename := strings.ToLower(strings.ReplaceAll(title, " ", "-")) + ".md"
		if ext := filepath.Ext(filename); ext == "" {
			filename += ".md"
		}

		relPath := strings.TrimPrefix(dirPath, "/") + filename

		existing, err := db.GetDocumentByPath(filename, dirPath)
		if err != nil {
			return "", fmt.Errorf("check existing: %w", err)
		}

		if existing != nil {
			if workspace != "" {
				if err := writeWikiPageFile(workspace, relPath, content); err != nil {
					return "", fmt.Errorf("write file: %w", err)
				}
			}
			if err := db.UpdateDocument(existing.ID, content, title, tags, "", ""); err != nil {
				return "", fmt.Errorf("update document: %w", err)
			}
			if indexer != nil {
				if workspace != "" {
					_ = indexer.IndexFile(relPath)
				} else {
					_ = indexer.IndexDocumentContent(existing.ID, content)
				}
			}
			activity.LogDocument(db, "updated", existing.ID, relPath, "mcp")
			return fmt.Sprintf("Updated: %s (ID: %s, version incremented)", title, existing.ID), nil
		}

		if workspace != "" {
			if err := writeWikiPageFile(workspace, relPath, content); err != nil {
				return "", fmt.Errorf("write file: %w", err)
			}
		}

		doc := &sqlite.Document{
			Filename:     filename,
			Title:        title,
			Path:         dirPath,
			RelativePath: relPath,
			SourceKind:   "wiki",
			FileType:     "md",
			Content:      content,
			Status:       "ready",
			Tags:         tags,
		}
		if err := db.CreateDocument(doc); err != nil {
			return "", fmt.Errorf("create document: %w", err)
		}

		if indexer != nil {
			if workspace != "" {
				_ = indexer.IndexFile(relPath)
			} else {
				_ = indexer.IndexDocumentContent(doc.ID, content)
			}
		}

		activity.LogDocument(db, "created", doc.ID, relPath, "mcp")
		return fmt.Sprintf("Created: %s (ID: %s, path: %s)", title, doc.ID, relPath), nil
	})

	registerTool(Tool{
		Name:        "delete",
		Description: "Delete a document from the knowledge vault. Supports path and glob patterns. Protected pages (overview.md, log.md) cannot be deleted.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"path": map[string]interface{}{"type": "string", "description": "Path or glob pattern to delete"},
			},
			"required": []string{"path"},
		},
	}, func(args map[string]interface{}) (string, error) {
		if db == nil {
			return "Error: database not connected", nil
		}

		path, _ := args["path"].(string)
		if path == "" {
			return "Error: path is required", nil
		}

		protected := map[string]bool{"overview.md": true, "log.md": true}
		base := filepath.Base(path)
		if protected[base] {
			return "Error: cannot delete protected page: " + base, nil
		}

		doc, err := db.FindDocumentByName(path)
		if err != nil {
			return "", fmt.Errorf("find document: %w", err)
		}
		if doc == nil {
			doc, err = db.GetDocument(path)
			if err != nil {
				return "", fmt.Errorf("get document: %w", err)
			}
		}
		if doc == nil {
			return "Document not found: " + path, nil
		}

		affected, err := db.ArchiveDocuments([]string{doc.ID})
		if err != nil {
			return "", fmt.Errorf("archive document: %w", err)
		}

		activity.LogDocument(db, "deleted", doc.ID, doc.RelativePath, "mcp")
		return fmt.Sprintf("Deleted %d document(s): %s (ID: %s)", affected, doc.Title, doc.ID), nil
	})

	registerTool(Tool{
		Name:        "ping",
		Description: "Test connectivity",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
			"required":   []string{},
		},
	}, func(args map[string]interface{}) (string, error) {
		return "pong", nil
	})
}

func writeWikiPageFile(workspace, relPath, content string) error {
	if !strings.HasPrefix(relPath, "wiki/") {
		return fmt.Errorf("refusing to write outside wiki/: %s", relPath)
	}
	fullPath := filepath.Join(workspace, relPath)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(fullPath, []byte(content), 0o644)
}

var _ = os.Args
