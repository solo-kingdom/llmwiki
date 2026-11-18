package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

func newExportCmd() *cobra.Command {
	var out string
	var includeRaw bool
	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export pages from PostgreSQL to a directory",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runExport(out, includeRaw)
		},
	}
	cmd.Flags().StringVar(&out, "out", "", "Output directory (required)")
	cmd.Flags().BoolVar(&includeRaw, "include-raw", false, "Also export stored source blobs under raw/sources/")
	_ = cmd.MarkFlagRequired("out")
	return cmd
}

func runExport(out string, includeRaw bool) error {
	if out == "" {
		return fmt.Errorf("--out is required")
	}
	db, err := openDatabase()
	if err != nil {
		return err
	}
	defer db.Close()

	docs, err := db.ListDocumentsWithContent()
	if err != nil {
		return fmt.Errorf("list documents: %w", err)
	}
	written := 0
	for _, doc := range docs {
		rel := filepath.FromSlash(doc.RelativePath)
		if rel == "" {
			continue
		}
		full := filepath.Join(out, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return fmt.Errorf("create dir: %w", err)
		}
		if err := os.WriteFile(full, []byte(doc.Content), 0o644); err != nil {
			return fmt.Errorf("write %s: %w", rel, err)
		}
		written++
	}

	rawCount := 0
	if includeRaw {
		blobs, err := db.ListSourceBlobs()
		if err != nil {
			return fmt.Errorf("list source blobs: %w", err)
		}
		for _, blob := range blobs {
			_, data, err := db.GetSourceBlob(blob.ID)
			if err != nil {
				return fmt.Errorf("read blob %s: %w", blob.ID, err)
			}
			full := filepath.Join(out, "raw", "sources", filepath.Base(blob.Filename))
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(full, data, 0o644); err != nil {
				return fmt.Errorf("write blob %s: %w", blob.Filename, err)
			}
			rawCount++
		}
	}

	fmt.Printf("Exported %d page(s) to %s\n", written, out)
	if includeRaw {
		fmt.Printf("Exported %d source file(s)\n", rawCount)
	}
	return nil
}
