package main

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	storesvc "github.com/solo-kingdom/llmwiki/internal/service"
	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/workspace"
)

func newInitCmd() *cobra.Command {
	var name string
	cmd := &cobra.Command{
		Use:   "init [dir]",
		Short: "Initialize a PostgreSQL-backed workspace",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := ""
			if len(args) > 0 {
				dir = args[0]
			}
			return runInit(dir, name)
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Workspace name (default: directory name or 'default')")
	return cmd
}

func runInit(dir, name string) error {
	db, err := openDatabase()
	if err != nil {
		return err
	}
	defer db.Close()

	wsName := name
	if wsName == "" && dir != "" {
		abs, err := filepath.Abs(dir)
		if err != nil {
			return fmt.Errorf("resolve path: %w", err)
		}
		wsName = filepath.Base(abs)
	}
	if wsName == "" {
		wsName = "default"
	}
	if err := db.UpsertWorkspace(&store.Workspace{ID: "default", Name: wsName, UserID: "default"}); err != nil {
		return fmt.Errorf("register workspace: %w", err)
	}

	if dir == "" {
		fmt.Printf("Initialized PostgreSQL workspace: %s\n", wsName)
		return nil
	}

	abs, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("resolve path: %w", err)
	}
	if err := engine.EnsureWorkspaceStructure(abs); err != nil {
		return fmt.Errorf("ensure workspace structure: %w", err)
	}
	initDate := time.Now().Format("2006-01-02")
	if err := engine.WriteWorkspaceScaffoldsIfMissing(abs, initDate); err != nil {
		return fmt.Errorf("write scaffolds: %w", err)
	}
	if err := ingest.WriteWorkspaceScaffoldsIfMissing(abs); err != nil {
		return err
	}
	if err := workspace.ImportSettings(db, abs); err != nil {
		return fmt.Errorf("import workspace settings: %w", err)
	}

	adapter := storesvc.NewStoreAdapter(db)
	reindexer := engine.NewReindexer(adapter, abs)
	count, err := reindexer.Rebuild("default")
	if err != nil {
		return fmt.Errorf("initial index: %w", err)
	}
	fmt.Printf("Initialized PostgreSQL workspace: %s\n", wsName)
	if count > 0 {
		fmt.Printf("Imported %d files from %s\n", count, abs)
	}
	return nil
}
