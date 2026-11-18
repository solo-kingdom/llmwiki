package main

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/spf13/cobra"
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

	db, err := openDatabase()
	if err != nil {
		return err
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

	pipeline := ingest.NewPipelineWithDB(ws, db, client)
	pipeline.SetForceOverwrite(forceOverwrite)
	pipeline.SetChangeSetMeta("ingest", "", "", filepath.Base(absSource), "")
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
