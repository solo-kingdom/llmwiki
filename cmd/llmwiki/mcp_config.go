package main

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

func newMCPConfigCmd() *cobra.Command {
	var port int
	var bind string

	cmd := &cobra.Command{
		Use:   "mcp-config [dir]",
		Short: "Print MCP configuration JSON for HTTP RPC endpoint",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := ""
			if len(args) > 0 {
				dir = args[0]
			}
			return runMCPConfig(dir, bind, port)
		},
	}

	cmd.Flags().IntVar(&port, "port", 8868, "HTTP port of llmwiki serve")
	cmd.Flags().StringVar(&bind, "bind", "127.0.0.1", "Bind address of llmwiki serve")

	return cmd
}

func runMCPConfig(dir, bind string, port int) error {
	ws, err := resolveWorkspaceDir(dir)
	if err != nil {
		return err
	}

	endpoint := fmt.Sprintf("http://%s:%d/mcp", bind, port)
	cfg := map[string]interface{}{
		"mcpServers": map[string]interface{}{
			"llmwiki": map[string]interface{}{
				"url":       endpoint,
				"transport": "http-post",
			},
		},
		"workspace": ws,
		"endpoint":  endpoint,
	}

	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	fmt.Println(string(out))
	return nil
}
