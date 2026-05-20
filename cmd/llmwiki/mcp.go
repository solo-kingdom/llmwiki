package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func newMCPCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "mcp [dir]",
		Short: "Run MCP JSON-RPC 2.0 server on stdin/stdout (legacy local mode)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := ""
			if len(args) > 0 {
				dir = args[0]
			}
			return runMCP(dir)
		},
	}
}

func runMCP(dir string) error {
	ws, err := resolveWorkspaceDir(dir)
	if err != nil {
		return err
	}

	db, err := sqlite.Open(workspaceIndexPath(ws))
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	fmt.Fprintf(os.Stderr, "LLM Wiki MCP (stdio) — workspace: %s\n", ws)
	return mcp.RunLocalMCP(ws, db)
}
