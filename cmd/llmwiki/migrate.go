package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/migrate"
	storesvc "github.com/solo-kingdom/llmwiki/internal/service"
	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/workspace"
)

func newMigrateCmd() *cobra.Command {
	var dir string
	var name string
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Import an existing workspace directory and legacy SQLite index into PostgreSQL",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runMigrate(dir, name)
		},
	}
	cmd.Flags().StringVar(&dir, "workspace", "", "Workspace directory to import (required)")
	cmd.Flags().StringVar(&name, "name", "", "Workspace name (default: directory name)")
	_ = cmd.MarkFlagRequired("workspace")
	return cmd
}

func runMigrate(dir, name string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("resolve workspace: %w", err)
	}
	if info, err := os.Stat(abs); err != nil || !info.IsDir() {
		return fmt.Errorf("workspace directory not found: %s", abs)
	}
	db, err := openDatabase()
	if err != nil {
		return err
	}
	defer db.Close()

	wsName := name
	if wsName == "" {
		wsName = filepath.Base(abs)
	}
	if err := db.UpsertWorkspace(&store.Workspace{ID: "default", Name: wsName, UserID: "default"}); err != nil {
		return fmt.Errorf("register workspace: %w", err)
	}

	legacy, err := migrate.ReadLegacy(filepath.Join(abs, ".llmwiki", "index.db"))
	if err != nil {
		return fmt.Errorf("read legacy index: %w", err)
	}
	for k, v := range legacy.Config {
		if k == "" {
			continue
		}
		if err := db.SetConfig(k, v); err != nil {
			return fmt.Errorf("import config %s: %w", k, err)
		}
	}
	for i := range legacy.Providers {
		if err := db.CreateProviderInstance(&legacy.Providers[i]); err != nil {
			// IDs may already exist on a re-run; continue with the rest.
			fmt.Fprintf(os.Stderr, "skip provider %s: %v\n", legacy.Providers[i].ID, err)
		}
	}
	if err := workspace.ImportSettings(db, abs); err != nil {
		return fmt.Errorf("import workspace settings: %w", err)
	}

	blobs, err := importSourceBlobs(db, abs)
	if err != nil {
		return err
	}

	adapter := storesvc.NewStoreAdapter(db)
	reindexer := engine.NewReindexer(adapter, abs)
	count, err := reindexer.Rebuild("default")
	if err != nil {
		return fmt.Errorf("import files: %w", err)
	}
	revisions, err := db.SeedInitialRevisions("migration")
	if err != nil {
		return fmt.Errorf("seed revisions: %w", err)
	}

	docs, err := db.ListDocuments()
	if err != nil {
		return fmt.Errorf("verify documents: %w", err)
	}
	fmt.Printf("Migrated workspace %s\n", abs)
	fmt.Printf("  files imported: %d (legacy index had %d documents)\n", count, legacy.DocumentCount)
	fmt.Printf("  documents in PostgreSQL: %d\n", len(docs))
	fmt.Printf("  initial revisions: %d\n", revisions)
	fmt.Printf("  source blobs: %d\n", blobs)
	if legacy.DocumentCount > 0 && len(docs) < legacy.DocumentCount {
		return fmt.Errorf("document count mismatch: imported %d < legacy %d", len(docs), legacy.DocumentCount)
	}
	return nil
}

func importSourceBlobs(db store.Store, workspaceDir string) (int, error) {
	root := filepath.Join(workspaceDir, "raw")
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return 0, nil
	}
	count := 0
	err = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.HasPrefix(filepath.Base(path), ".") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		blob := &store.SourceBlob{Filename: filepath.Base(path), MediaType: "application/octet-stream"}
		if err := db.CreateSourceBlob(blob, data); err != nil {
			return fmt.Errorf("store blob %s: %w", path, err)
		}
		count++
		return nil
	})
	return count, err
}
