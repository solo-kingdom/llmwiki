package vcs

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// CommitEntry represents a parsed git log entry.
type CommitEntry struct {
	SHA       string `json:"sha"`
	Subject   string `json:"subject"`
	Timestamp string `json:"timestamp"`
	FilesChanged int  `json:"files_changed"`
}

// CommitMessage represents a parsed structured commit message.
type CommitMessage struct {
	JobID       string `json:"job_id"`
	Source      string `json:"source"`
	SourceType  string `json:"source_type"`
	Normalized  string `json:"normalized"`
	Subject     string `json:"subject"`
}

// GitRepo wraps git CLI operations for a workspace directory.
type GitRepo struct {
	workDir string // workspace root directory
}

// NewGitRepo creates a GitRepo handle. Does not check if git is initialized.
func NewGitRepo(workDir string) *GitRepo {
	return &GitRepo{workDir: workDir}
}

// GitAvailability reports whether git CLI is accessible and its version.
type GitAvailability struct {
	Available bool   `json:"available"`
	Version   string `json:"version"`
}

// IsGitAvailable checks whether git CLI is available on the system PATH.
// Returns availability status and version string.
func IsGitAvailable() GitAvailability {
	path, err := exec.LookPath("git")
	if err != nil || path == "" {
		return GitAvailability{Available: false}
	}
	out, err := exec.Command("git", "--version").Output()
	if err != nil {
		return GitAvailability{Available: false}
	}
	ver := strings.TrimSpace(string(out))
	ver = strings.TrimPrefix(ver, "git version ")
	return GitAvailability{Available: true, Version: ver}
}

// IsInitialized checks whether a git repo exists in the workspace directory.
func (r *GitRepo) IsInitialized() bool {
	gitDir := filepath.Join(r.workDir, ".git")
	info, err := os.Stat(gitDir)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// InitRepo initializes a git repository in the workspace.
// Creates .gitignore with required entries, adds wiki/ and creates initial commit.
func InitRepo(workDir string) (*GitRepo, error) {
	if !IsGitAvailable().Available {
		return nil, fmt.Errorf("git is not installed. Please install git to enable version control")
	}

	repo := &GitRepo{workDir: workDir}

	// git init
	if err := repo.runGit("init"); err != nil {
		return nil, fmt.Errorf("git init: %w", err)
	}

	// Ensure .gitignore has required entries
	if err := repo.ensureGitignore(); err != nil {
		return nil, fmt.Errorf("gitignore setup: %w", err)
	}

	// git add wiki/ and .gitignore
	if err := repo.runGit("add", "wiki/", ".gitignore"); err != nil {
		// wiki/ might not exist yet, that's ok
		_ = repo.runGit("add", ".gitignore")
	}

	// Check if there's anything to commit
	hasChanges, _ := repo.hasStagedChanges()
	if hasChanges {
		if err := repo.runGit("commit", "-m", "initial: existing wiki"); err != nil {
			return nil, fmt.Errorf("initial commit: %w", err)
		}
	}

	return repo, nil
}

// AddCommit stages wiki/ changes and commits them with the given message.
// Returns the commit SHA. Skips commit if there are no changes.
func (r *GitRepo) AddCommit(message string) (string, error) {
	// git add wiki/
	if err := r.runGit("add", "wiki/"); err != nil {
		return "", fmt.Errorf("git add: %w", err)
	}

	// Check if there are staged changes
	hasChanges, err := r.hasStagedChanges()
	if err != nil {
		return "", fmt.Errorf("check staged changes: %w", err)
	}
	if !hasChanges {
		return "", nil // nothing to commit
	}

	// git commit
	if err := r.runGit("commit", "-m", message); err != nil {
		return "", fmt.Errorf("git commit: %w", err)
	}

	// Get the SHA of the commit we just made
	return r.lastCommitSHA()
}

// Log returns the most recent commit entries, up to limit.
func (r *GitRepo) Log(limit int) ([]CommitEntry, error) {
	if limit <= 0 {
		limit = 50
	}

	// Format: short SHA | subject | timestamp | files changed count
	out, err := r.gitOutput("log", "--oneline",
		fmt.Sprintf("--max-count=%d", limit),
		"--pretty=format:%h|%s|%ci",
		"--shortstat")
	if err != nil {
		if strings.Contains(err.Error(), "does not have any commits yet") ||
			strings.Contains(err.Error(), "unknown revision") {
			return nil, nil
		}
		return nil, fmt.Errorf("git log: %w", err)
	}

	return parseLogOutput(out), nil
}

// Diff returns the unified diff for a given commit SHA.
func (r *GitRepo) Diff(commitSHA string) (string, error) {
	// Check if this is the initial commit (no parent)
	parentRef := commitSHA + "^"
	_, err := r.gitOutput("rev-parse", "--verify", parentRef)
	if err != nil {
		// Likely initial commit, use diff against empty tree
		out, err := r.gitOutput("diff", "--root", commitSHA)
		if err != nil {
			return "", fmt.Errorf("git diff (initial): %w", err)
		}
		return out, nil
	}

	out, err := r.gitOutput("diff", parentRef, commitSHA)
	if err != nil {
		return "", fmt.Errorf("git diff: %w", err)
	}
	return out, nil
}

// ShowMessage parses the commit message for a given SHA into structured data.
func (r *GitRepo) ShowMessage(commitSHA string) (*CommitMessage, error) {
	out, err := r.gitOutput("show", commitSHA, "--format=%B", "--no-patch")
	if err != nil {
		return nil, fmt.Errorf("git show: %w", err)
	}

	return parseCommitMessage(out), nil
}

// BuildCommitMessage constructs a structured commit message string.
func BuildCommitMessage(sourceFilename, jobID, sourceType, normalizedContent string) string {
	const maxNormalizedSize = 1 << 20 // 1MB

	// Truncate if needed
	truncated := false
	content := normalizedContent
	if len(content) > maxNormalizedSize {
		content = content[:maxNormalizedSize]
		truncated = true
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("ingest: %s", sourceFilename))
	sb.WriteString("\n\n")
	sb.WriteString("---META---\n")
	sb.WriteString(fmt.Sprintf("job_id: %s\n", jobID))
	sb.WriteString(fmt.Sprintf("source: %s\n", sourceFilename))
	sb.WriteString(fmt.Sprintf("source_type: %s\n", sourceType))
	sb.WriteString("---NORMALIZED-START---\n")
	sb.WriteString(content)
	if truncated {
		sb.WriteString("\n---NORMALIZED-TRUNCATED---")
	}
	sb.WriteString("\n---NORMALIZED-END---")

	return sb.String()
}

// BuildRollbackCommitMessage constructs a commit message for rollback operations.
func BuildRollbackCommitMessage(sourceFilename string) string {
	return fmt.Sprintf("rollback: %s", sourceFilename)
}

// runGit executes a git command in the workspace directory.
func (r *GitRepo) runGit(args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = r.workDir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=llmwiki",
		"GIT_AUTHOR_EMAIL=llmwiki@local",
		"GIT_COMMITTER_NAME=llmwiki",
		"GIT_COMMITTER_EMAIL=llmwiki@local",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// gitOutput executes a git command and returns its stdout.
func (r *GitRepo) gitOutput(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = r.workDir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=llmwiki",
		"GIT_AUTHOR_EMAIL=llmwiki@local",
		"GIT_COMMITTER_NAME=llmwiki",
		"GIT_COMMITTER_EMAIL=llmwiki@local",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// hasStagedChanges checks if there are staged changes ready to commit.
func (r *GitRepo) hasStagedChanges() (bool, error) {
	out, err := r.gitOutput("diff", "--cached", "--quiet")
	if err != nil {
		// git diff --cached --quiet exits with 1 if there are changes
		return true, nil
	}
	// No output and no error means no changes
	_ = out
	return false, nil
}

// lastCommitSHA returns the SHA of the most recent commit.
func (r *GitRepo) lastCommitSHA() (string, error) {
	out, err := r.gitOutput("rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// ensureGitignore ensures .gitignore contains the required entries.
func (r *GitRepo) ensureGitignore() error {
	required := []string{".llmwiki/", "raw/", "revert/"}
	gitignorePath := filepath.Join(r.workDir, ".gitignore")

	// Read existing content
	var existing string
	data, err := os.ReadFile(gitignorePath)
	if err == nil {
		existing = string(data)
	}

	var lines []string
	if existing != "" {
		lines = strings.Split(existing, "\n")
	}

	// Add missing entries
	existingSet := make(map[string]bool)
	for _, line := range lines {
		existingSet[strings.TrimSpace(line)] = true
	}

	modified := false
	for _, entry := range required {
		if !existingSet[entry] {
			lines = append(lines, entry)
			modified = true
		}
	}

	if modified {
		content := strings.Join(lines, "\n")
		// Ensure trailing newline
		if !strings.HasSuffix(content, "\n") {
			content += "\n"
		}
		return os.WriteFile(gitignorePath, []byte(content), 0o644)
	}

	return nil
}

// parseLogOutput parses git log output with shortstat into CommitEntry list.
func parseLogOutput(output string) []CommitEntry {
	var entries []CommitEntry

	// The output format with --shortstat interleaves stat lines after each entry.
	// We need a different approach: use --name-status or separate queries.
	// For simplicity, let's parse using a simpler format.
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Try to parse the main format line: sha|subject|timestamp
		parts := strings.SplitN(line, "|", 3)
		if len(parts) == 3 {
			ts := strings.TrimSpace(parts[2])
			if _, err := time.Parse("2006-01-02 15:04:05 -0700", ts); err == nil ||
				strings.Contains(ts, ":") || strings.Contains(ts, "-") {
				entries = append(entries, CommitEntry{
					SHA:       strings.TrimSpace(parts[0]),
					Subject:   strings.TrimSpace(parts[1]),
					Timestamp: ts,
				})
			}
		}
	}

	return entries
}

// LogWithStats returns commit entries with file change counts.
func (r *GitRepo) LogWithStats(limit int) ([]CommitEntry, error) {
	if limit <= 0 {
		limit = 50
	}

	// First get the commit list
	entries, err := r.Log(limit)
	if err != nil {
		return nil, err
	}

	// Then get file change counts per commit
	for i := range entries {
		count, _ := r.filesChanged(entries[i].SHA)
		entries[i].FilesChanged = count
	}

	return entries, nil
}

// filesChanged returns the number of files changed in a commit.
func (r *GitRepo) filesChanged(sha string) (int, error) {
	out, err := r.gitOutput("diff", "--name-only", sha+"^", sha)
	if err != nil {
		// Initial commit
		out2, err2 := r.gitOutput("diff", "--name-only", "--root", sha)
		if err2 != nil {
			return 0, err2
		}
		out = out2
	}
	files := strings.Split(strings.TrimSpace(out), "\n")
	count := 0
	for _, f := range files {
		if strings.TrimSpace(f) != "" {
			count++
		}
	}
	return count, nil
}

// parseCommitMessage parses a structured commit message into a CommitMessage.
func parseCommitMessage(raw string) *CommitMessage {
	msg := &CommitMessage{}
	lines := strings.Split(raw, "\n")

	// First line is the subject
	if len(lines) > 0 {
		msg.Subject = strings.TrimSpace(lines[0])
	}

	// Find META section
	inMeta := false
	inNormalized := false
	var normalizedLines []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if trimmed == "---META---" {
			inMeta = true
			continue
		}
		if trimmed == "---NORMALIZED-START---" {
			inMeta = false
			inNormalized = true
			continue
		}
		if trimmed == "---NORMALIZED-END---" || trimmed == "---NORMALIZED-TRUNCATED---" {
			inNormalized = false
			continue
		}

		if inMeta {
			if strings.HasPrefix(trimmed, "job_id:") {
				msg.JobID = strings.TrimSpace(strings.TrimPrefix(trimmed, "job_id:"))
			} else if strings.HasPrefix(trimmed, "source:") {
				msg.Source = strings.TrimSpace(strings.TrimPrefix(trimmed, "source:"))
			} else if strings.HasPrefix(trimmed, "source_type:") {
				msg.SourceType = strings.TrimSpace(strings.TrimPrefix(trimmed, "source_type:"))
			}
		}

		if inNormalized {
			normalizedLines = append(normalizedLines, line)
		}
	}

	msg.Normalized = strings.Join(normalizedLines, "\n")
	return msg
}

// CommitCount returns the total number of commits in the repo.
func (r *GitRepo) CommitCount() (int, error) {
	out, err := r.gitOutput("rev-list", "--count", "HEAD")
	if err != nil {
		return 0, err
	}
	count, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0, err
	}
	return count, nil
}
