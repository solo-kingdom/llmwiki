package service

import (
	"fmt"
	"os"
	"path/filepath"
)

func DiscoverWorkspace(dir string) (dbPath string, workspaceRoot string, err error) {
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return "", "", fmt.Errorf("resolve path: %w", err)
	}

	dbPath = filepath.Join(absDir, ".llmwiki", "index.db")
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return "", "", fmt.Errorf("not a valid workspace: %s (missing .llmwiki/index.db)", absDir)
	}

	return dbPath, absDir, nil
}
