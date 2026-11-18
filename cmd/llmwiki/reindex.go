package main

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
)

func newReindexCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "reindex",
		Short: "Rebuild chunks and references from PostgreSQL content",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runReindex()
		},
	}
}

func runReindex() error {
	db, err := openDatabase()
	if err != nil {
		return err
	}
	defer db.Close()
	count, err := ingest.RebuildDerived(db)
	if err != nil {
		return fmt.Errorf("reindex: %w", err)
	}
	fmt.Printf("Rebuilt derived index for %d document(s)\n", count)
	return nil
}
