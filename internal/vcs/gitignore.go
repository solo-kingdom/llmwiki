package vcs

import (
	"os"
	"path/filepath"
	"strings"
)

// FineGrainedGitignoreEntries are always excluded from git (backup track may still add tracked paths under .llmwiki/).
var FineGrainedGitignoreEntries = []string{
	".llmwiki/cache/",
	".llmwiki/index.db",
	".llmwiki/worktrees/",
	"revert/",
}

const legacyLLmwikiIgnore = ".llmwiki/"
const rawIgnoreEntry = "raw/"

// ensureGitignore ensures fine-grained .gitignore rules and migrates legacy blanket .llmwiki/ exclusion.
func (r *GitRepo) ensureGitignore() error {
	return r.applyGitignoreLines(FineGrainedGitignoreEntries, true)
}

// EnsureGitignoreForBackup updates gitignore for backup policy (raw/ exclusion when disabled).
func (r *GitRepo) EnsureGitignoreForBackup(includeRaw bool) error {
	if err := r.ensureGitignore(); err != nil {
		return err
	}
	if includeRaw {
		return r.removeGitignoreLine(rawIgnoreEntry)
	}
	return r.appendGitignoreLine(rawIgnoreEntry)
}

func (r *GitRepo) applyGitignoreLines(required []string, migrateLegacy bool) error {
	gitignorePath := filepath.Join(r.workDir, ".gitignore")

	var lines []string
	if data, err := os.ReadFile(gitignorePath); err == nil {
		lines = strings.Split(string(data), "\n")
	}

	if migrateLegacy {
		var filtered []string
		for _, line := range lines {
			if strings.TrimSpace(line) == legacyLLmwikiIgnore {
				continue
			}
			filtered = append(filtered, line)
		}
		lines = filtered
	}

	existingSet := make(map[string]bool)
	for _, line := range lines {
		existingSet[strings.TrimSpace(line)] = true
	}

	modified := migrateLegacy
	for _, entry := range required {
		if !existingSet[entry] {
			lines = append(lines, entry)
			modified = true
		}
	}

	if !modified {
		return nil
	}

	content := strings.Join(lines, "\n")
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return os.WriteFile(gitignorePath, []byte(content), 0o644)
}

func (r *GitRepo) appendGitignoreLine(entry string) error {
	gitignorePath := filepath.Join(r.workDir, ".gitignore")
	data, err := os.ReadFile(gitignorePath)
	var lines []string
	if err == nil {
		lines = strings.Split(string(data), "\n")
	}
	for _, line := range lines {
		if strings.TrimSpace(line) == entry {
			return nil
		}
	}
	lines = append(lines, entry)
	content := strings.Join(lines, "\n")
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return os.WriteFile(gitignorePath, []byte(content), 0o644)
}

func (r *GitRepo) removeGitignoreLine(entry string) error {
	gitignorePath := filepath.Join(r.workDir, ".gitignore")
	data, err := os.ReadFile(gitignorePath)
	if err != nil {
		return nil
	}
	lines := strings.Split(string(data), "\n")
	var out []string
	removed := false
	for _, line := range lines {
		if strings.TrimSpace(line) == entry {
			removed = true
			continue
		}
		out = append(out, line)
	}
	if !removed {
		return nil
	}
	content := strings.Join(out, "\n")
	if content != "" && !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return os.WriteFile(gitignorePath, []byte(content), 0o644)
}
