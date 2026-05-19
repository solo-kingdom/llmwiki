package mcp

import "os"

// RunLocalMCP starts the MCP server in stdio mode.
// workspace is the path to the workspace directory.
func RunLocalMCP(workspace string) error {
	server := NewServer("LLM Wiki",
		"You are connected to an LLM Wiki workspace. Call the `guide` tool first to see available knowledge bases and learn the full workflow.",
	)

	// Register tools
	RegisterTools(server, workspace)

	return server.Run()
}

// RegisterTools registers all MCP tools on the server.
func RegisterTools(server *Server, workspace string) {
	// guide
	server.RegisterTool(Tool{
		Name:        "guide",
		Description: "Get started with LLM Wiki. Call this to understand how the knowledge vault works and see your available knowledge bases.",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
			"required":   []string{},
		},
	}, func(args map[string]interface{}) (string, error) {
		return "LLM Wiki — workspace: " + workspace + "\n\nWiki files are in " + workspace + "/wiki/\nSource files are in " + workspace + "/raw/sources/", nil
	})

	// search
	server.RegisterTool(Tool{
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
		return "Search not yet implemented. Workspace: " + workspace, nil
	})

	// read
	server.RegisterTool(Tool{
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
		return "Read not yet implemented. Workspace: " + workspace, nil
	})

	// write
	server.RegisterTool(Tool{
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
		return "Write not yet implemented. Workspace: " + workspace, nil
	})

	// delete
	server.RegisterTool(Tool{
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
		return "Delete not yet implemented. Workspace: " + workspace, nil
	})

	// ping
	server.RegisterTool(Tool{
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

// Ensure os package usage
var _ = os.Args
