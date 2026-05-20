package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
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

	if isWorkspaceInitialized(abs) {
		fmt.Printf("Workspace already initialized: %s\n", abs)
		return nil
	}

	dirs := []string{
		"wiki",
		"wiki/entities",
		"wiki/concepts",
		"wiki/sources",
		"raw/sources",
		"revert",
		".llmwiki",
		".llmwiki/cache",
	}
	for _, d := range dirs {
		if err := os.MkdirAll(filepath.Join(abs, d), 0o755); err != nil {
			return fmt.Errorf("create %s: %w", d, err)
		}
	}

	scaffolds := map[string]string{
		"wiki/overview.md": `---
title: Overview
description: Global knowledge base overview (auto-maintained)
---

# Overview

Welcome to your LLM Wiki workspace. This page is automatically maintained as you ingest sources.
`,
		"wiki/log.md": `---
title: Operation Log
---

# Operation Log

`,
		"purpose.md": `---
title: Research Purpose
---

# Purpose

Describe your research goals, key questions, and scope here.
`,
	}
	for rel, content := range scaffolds {
		path := filepath.Join(abs, rel)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
				return fmt.Errorf("write %s: %w", rel, err)
			}
		}
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
