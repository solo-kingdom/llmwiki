package main

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func newIngestCmd() *cobra.Command {
	var forceOverwrite bool
	cmd := &cobra.Command{
		Use:   "ingest <file>",
		Short: "Ingest a source file into the workspace",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runIngest("", args[0], forceOverwrite)
		},
	}
	cmd.Flags().BoolVar(&forceOverwrite, "force-overwrite", false, "Skip merge protection and overwrite existing wiki pages")
	return cmd
}

func runIngest(workspaceDir, sourceFile string, forceOverwrite bool) error {
	ws, err := resolveWorkspaceDir(workspaceDir)
	if err != nil {
		return err
	}

	absSource, err := filepath.Abs(sourceFile)
	if err != nil {
		return fmt.Errorf("resolve source path: %w", err)
	}

	db, err := sqlite.Open(workspaceIndexPath(ws))
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	wsCfg, err := llm.LoadConfig(ws)
	if err != nil {
		return fmt.Errorf("load LLM config: %w", err)
	}
	client := llm.NewClient(llm.Config{
		Provider: wsCfg.Provider,
		BaseURL:  wsCfg.BaseURL,
		APIKey:   wsCfg.APIKey,
		Model:    wsCfg.Model,
	})

	pipeline := ingest.NewPipeline(ws, client)
	pipeline.SetForceOverwrite(forceOverwrite)
	files, err := pipeline.Ingest(context.Background(), absSource)
	if err != nil {
		return fmt.Errorf("ingest: %w", err)
	}

	fmt.Printf("Ingest complete: %d wiki file(s) written\n", len(files))
	for _, f := range files {
		fmt.Printf("  - %s\n", f)
	}
	return nil
}
