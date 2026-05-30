package main

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
	"github.com/solo-kingdom/llmwiki/internal/workspace"
)

func newInitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init <dir>",
		Short: "Initialize a new workspace directory",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runInit(args[0])
		},
	}
}

func runInit(dir string) error {
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

	if err := ensureVersionControl(abs); err != nil {
		return err
	}

	if isWorkspaceInitialized(abs) {
		fmt.Printf("Workspace already initialized: %s\n", abs)
		return nil
	}

	dbPath := workspaceIndexPath(abs)
	db, err := sqlite.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	name := filepath.Base(abs)
	if _, err := db.DB().Exec(
		`INSERT OR IGNORE INTO workspace (id, name, description, user_id) VALUES ('default', ?, '', 'default')`,
		name,
	); err != nil {
		return fmt.Errorf("register workspace: %w", err)
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

	fmt.Printf("Initialized workspace: %s\n", abs)
	fmt.Printf("Indexed %d files\n", count)
	return nil
}

func ensureVersionControl(dir string) error {
	if !vcs.IsGitAvailable().Available {
		return fmt.Errorf("git is not installed. Please install git to initialize version control")
	}

	repo := vcs.NewGitRepo(dir)
	if repo.IsInitialized() {
		return nil
	}

	if _, err := vcs.InitRepo(dir); err != nil {
		return fmt.Errorf("initialize version control: %w", err)
	}
	return nil
}
