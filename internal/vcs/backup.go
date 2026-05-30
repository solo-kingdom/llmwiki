package vcs

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const backupCommitSubject = "backup: snapshot"

// BackupPaths returns paths to include in a backup track commit.
func BackupPaths(workDir string, includeRaw bool) []string {
	paths := []string{
		"purpose.md",
		"rules.md",
		".gitignore",
		".llmwiki/workspace-settings.json",
		".llmwiki/prompts.yaml",
	}
	if includeRaw {
		paths = append(paths, "raw/")
	}
	var existing []string
	for _, p := range paths {
		full := filepath.Join(workDir, filepath.FromSlash(p))
		if strings.HasSuffix(p, "/") {
			if info, err := os.Stat(full); err == nil && info.IsDir() {
				existing = append(existing, p)
			}
			continue
		}
		if _, err := os.Stat(full); err == nil {
			existing = append(existing, p)
		}
	}
	return existing
}

// BackupCommit stages backup paths and creates a backup track commit. Skips if no changes.
func (r *GitRepo) BackupCommit(includeRaw bool) (string, error) {
	if err := r.EnsureGitignoreForBackup(includeRaw); err != nil {
		return "", fmt.Errorf("gitignore for backup: %w", err)
	}

	paths := BackupPaths(r.workDir, includeRaw)
	if len(paths) == 0 {
		return "", nil
	}

	for _, p := range paths {
		if err := r.runGit("add", p); err != nil {
			return "", fmt.Errorf("git add %s: %w", p, err)
		}
	}

	hasChanges, err := r.hasStagedChanges()
	if err != nil {
		return "", fmt.Errorf("check staged changes: %w", err)
	}
	if !hasChanges {
		return "", nil
	}

	if err := r.runGit("commit", "-m", backupCommitSubject); err != nil {
		return "", fmt.Errorf("git commit: %w", err)
	}
	return r.lastCommitSHA()
}

// IsIngestCommitSubject reports whether a commit subject belongs to track A (ingest/rollback).
func IsIngestCommitSubject(subject string) bool {
	return strings.HasPrefix(subject, "ingest:") || strings.HasPrefix(subject, "rollback:")
}
