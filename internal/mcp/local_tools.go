package mcp

import (
	"fmt"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// Base tool definitions shared across modes.

var searchTool = Tool{
	Name:        DefaultToolSearch,
	Description: "Browse or search the knowledge vault. Modes: list, search, references, lint.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"mode":  map[string]interface{}{"type": "string", "enum": []string{"list", "search", "references", "lint"}, "default": "list"},
			"query": map[string]interface{}{"type": "string", "default": ""},
			"path":  map[string]interface{}{"type": "string", "default": "*"},
			"limit": map[string]interface{}{"type": "integer", "default": 10},
		},
		"required": []string{},
	},
}

var readTool = Tool{
	Name:        DefaultToolRead,
	Description: "Read a document from the knowledge vault by path or document id.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path": map[string]interface{}{"type": "string", "description": "Path to the document to read"},
		},
		"required": []string{"path"},
	},
}

var referencesTool = Tool{
	Name:        "references",
	Description: "Query the citation and link graph for a document. Returns backlinks (pages linking to this page) and forward references (pages this page links to).",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query": map[string]interface{}{"type": "string", "description": "Document ID or path to query references for"},
		},
		"required": []string{"query"},
	},
}

// BuiltinReadonlyToolDefinitions returns local search/read tool schemas (default ingest mode).
func BuiltinReadonlyToolDefinitions() []Tool {
	return []Tool{searchTool, readTool}
}

// BuiltinToolDefinitionsForMode returns tool schemas appropriate for the session mode.
func BuiltinToolDefinitionsForMode(mode string) []Tool {
	base := []Tool{searchTool, readTool}
	switch mode {
	case "qa":
		return append(base, referencesTool)
	case "organize":
		return append(base, referencesTool, auditTool, structureTool, gapsTool, similarTool)
	default:
		return base
	}
}

// ToolLoopConfigForMode returns tool loop parameters appropriate for the session mode.
func ToolLoopConfigForMode(mode string) llm.ToolLoopConfig {
	switch mode {
	case "qa":
		return llm.ToolLoopConfig{MaxRounds: 3, MaxToolCallsPerRound: 4}
	case "organize":
		return llm.ToolLoopConfig{MaxRounds: 6, MaxToolCallsPerRound: 4}
	default:
		return llm.ToolLoopConfig{MaxRounds: 4, MaxToolCallsPerRound: 4}
	}
}

// ToolTemperatureForMode returns the LLM temperature appropriate for the session mode.
func ToolTemperatureForMode(mode string) float64 {
	switch mode {
	case "qa":
		return 0.5
	case "organize":
		return 0.6
	default:
		return 0.7
	}
}

// ToolMaxTokensForMode returns the max output tokens appropriate for the session mode.
func ToolMaxTokensForMode(mode string) int {
	switch mode {
	case "organize":
		return 3072
	default:
		return 2048
	}
}

// ExecuteLocalReadonlyTool runs builtin search or read against the workspace index.
func ExecuteLocalReadonlyTool(workspace string, db *sqlite.DB, name string, args map[string]interface{}) (string, error) {
	if db == nil {
		return "Error: database not connected", nil
	}
	switch strings.ToLower(strings.TrimSpace(name)) {
	case DefaultToolSearch:
		return executeLocalSearch(workspace, db, args)
	case DefaultToolRead:
		return executeLocalRead(db, args)
	case "references":
		return executeLocalReferences(db, args)
	case "audit":
		return executeLocalAudit(workspace, db, args)
	case "structure":
		return executeLocalStructure(workspace, db, args)
	case "gaps":
		return executeLocalGaps(workspace, db, args)
	case "similar":
		return executeLocalSimilar(db, args)
	default:
		return "", fmt.Errorf("unknown local tool %q", name)
	}
}

func executeLocalSearch(workspace string, db *sqlite.DB, args map[string]interface{}) (string, error) {
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
			return "", err
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
		if strings.TrimSpace(query) == "" {
			return "Error: query is required for search mode", nil
		}
		results, err := db.SearchChunks(query, limit, pathFilter)
		if err != nil {
			return "", err
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
		return executeLocalReferences(db, args)
	case "lint":
		if workspace == "" {
			return "Error: workspace not configured", nil
		}
		report, err := engine.LintWorkspace(workspace)
		if err != nil {
			return "", err
		}
		return formatLintMCP(report), nil
	default:
		return "Unknown mode: " + mode, nil
	}
}

func executeLocalReferences(db *sqlite.DB, args map[string]interface{}) (string, error) {
	query, _ := args["query"].(string)
	if strings.TrimSpace(query) == "" {
		return "Error: query (document ID) is required for references mode", nil
	}
	backlinks, err := db.GetBacklinks(query)
	if err != nil {
		return "", err
	}
	fwd, err := db.GetForwardReferences(query)
	if err != nil {
		return "", err
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
}

func executeLocalRead(db *sqlite.DB, args map[string]interface{}) (string, error) {
	path, _ := args["path"].(string)
	if strings.TrimSpace(path) == "" {
		return "Error: path is required", nil
	}
	doc, err := db.GetDocument(path)
	if err != nil || doc == nil {
		doc, err = db.FindDocumentByName(path)
		if err != nil {
			return "", err
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
}
