package main

import (
	"fmt"
	"os"
	"path/filepath"
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
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("resolve workspace path: %w", err)
	}
	return abs, nil
}
