package main

import (
	"fmt"
	"os"
	"path/filepath"

	storesvc "github.com/solo-kingdom/llmwiki/internal/store"
)

func resolveWorkspaceDir(arg string) (string, error) {
	dir := arg
	if dir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("get working directory: %w", err)
		}
		dir = cwd
	}
	_, ws, err := storesvc.DiscoverWorkspace(dir)
	if err != nil {
		return "", err
	}
	return ws, nil
}

func workspaceIndexPath(ws string) string {
	return filepath.Join(ws, ".llmwiki", "index.db")
}

func isWorkspaceInitialized(ws string) bool {
	_, err := os.Stat(workspaceIndexPath(ws))
	return err == nil
}
