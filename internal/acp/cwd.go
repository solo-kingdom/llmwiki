package acp

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ResolveCWD returns an absolute working directory constrained to workspace.
func ResolveCWD(workspace, sessionID, policy string) (string, error) {
	if strings.TrimSpace(workspace) == "" {
		return "", fmt.Errorf("workspace is required")
	}
	workspaceAbs, err := filepath.Abs(workspace)
	if err != nil {
		return "", fmt.Errorf("resolve workspace: %w", err)
	}
	switch policy {
	case "workspace":
		if err := assertWithinWorkspace(workspaceAbs, workspaceAbs); err != nil {
			return "", err
		}
		return workspaceAbs, nil
	case "session":
		if sessionID == "" || sessionID == "." || sessionID == ".." ||
			strings.ContainsAny(sessionID, `/\`) {
			return "", fmt.Errorf("invalid session id for ACP cwd")
		}
		dir := filepath.Join(workspaceAbs, ".llmwiki", "cache", "acp", "sessions", sessionID)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", fmt.Errorf("create ACP session cwd: %w", err)
		}
		if err := assertWithinWorkspace(workspaceAbs, dir); err != nil {
			return "", err
		}
		return dir, nil
	default:
		return "", fmt.Errorf("unknown ACP cwd_policy %q", policy)
	}
}

func assertWithinWorkspace(workspace, target string) error {
	workspaceAbs, err := filepath.Abs(workspace)
	if err != nil {
		return fmt.Errorf("resolve workspace path: %w", err)
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return fmt.Errorf("resolve target path: %w", err)
	}
	workspaceReal, err := filepath.EvalSymlinks(workspaceAbs)
	if err != nil {
		return fmt.Errorf("evaluate workspace symlinks: %w", err)
	}
	targetReal, err := filepath.EvalSymlinks(targetAbs)
	if err != nil {
		return fmt.Errorf("evaluate target symlinks: %w", err)
	}
	if targetReal != workspaceReal && !strings.HasPrefix(targetReal, workspaceReal+string(os.PathSeparator)) {
		return fmt.Errorf("ACP working directory %q is outside workspace %q", targetReal, workspaceReal)
	}
	return nil
}
