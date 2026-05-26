package main

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func newReindexCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "reindex [dir]",
		Short: "Rebuild the SQLite index from workspace files",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := ""
			if len(args) > 0 {
				dir = args[0]
			}
			return runReindex(dir)
		},
	}
}

func runReindex(dir string) error {
	ws, err := resolveWorkspaceDir(dir)
	if err != nil {
		return err
	}

	dbPath, _, err := storesvc.DiscoverWorkspace(ws)
	if err != nil {
		return err
	}

	db, err := sqlite.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	if err := clearDerivedIndex(db); err != nil {
		return fmt.Errorf("clear index: %w", err)
	}

	adapter := storesvc.NewStoreAdapter(db)
	reindexer := engine.NewReindexer(adapter, ws)
	count, err := reindexer.Rebuild("default")
	if err != nil {
		return fmt.Errorf("reindex: %w", err)
	}

	fmt.Printf("Reindexed %d files in %s\n", count, ws)
	return nil
}

func clearDerivedIndex(db *sqlite.DB) error {
	_, err := db.DB().Exec(`
		DELETE FROM document_references;
		DELETE FROM document_chunks;
		DELETE FROM document_pages;
		DELETE FROM documents;
	`)
	return err
}
