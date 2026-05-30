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

// isRootCommit reports whether the commit has no parent (repository root).
func (r *GitRepo) isRootCommit(sha string) bool {
	_, err := r.gitOutput("rev-parse", "--verify", sha+"^")
	return err != nil
}

// Diff returns the unified diff for a given commit SHA.
// Root commits return an empty diff (baseline snapshot, not an ingest change).
func (r *GitRepo) Diff(commitSHA string) (string, error) {
	if r.isRootCommit(commitSHA) {
		return "", nil
	}

	parentRef := commitSHA + "^"
	out, err := r.gitOutput("-c", "core.quotepath=false", "diff", parentRef, commitSHA)
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

// LastCommitSHA returns the SHA of the most recent commit (exported).
func (r *GitRepo) LastCommitSHA() (string, error) {
	return r.lastCommitSHA()
}

// lastCommitSHA returns the SHA of the most recent commit.
func (r *GitRepo) lastCommitSHA() (string, error) {
	out, err := r.gitOutput("rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
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

// LogIngestOnly returns ingest/rollback commits with file change counts (excludes backup:).
func (r *GitRepo) LogIngestOnly(limit int) ([]CommitEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	// Fetch extra commits so filtering still fills the limit.
	fetch := limit * 4
	if fetch < 50 {
		fetch = 50
	}
	entries, err := r.LogWithStats(fetch)
	if err != nil {
		return nil, err
	}
	var filtered []CommitEntry
	for _, e := range entries {
		if IsIngestCommitSubject(e.Subject) {
			filtered = append(filtered, e)
			if len(filtered) >= limit {
				break
			}
		}
	}
	return filtered, nil
}

// filesChanged returns the number of files changed in a commit.
func (r *GitRepo) filesChanged(sha string) (int, error) {
	if r.isRootCommit(sha) {
		return 0, nil
	}

	out, err := r.gitOutput("-c", "core.quotepath=false", "diff", "--name-only", sha+"^", sha)
	if err != nil {
		return 0, err
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

// --- Worktree management for parallel job execution ---

// WorktreeDir returns the path to the worktree directory for a given job ID.
func (r *GitRepo) WorktreeDir(jobID string) string {
	return filepath.Join(r.workDir, ".llmwiki", "worktrees", jobID)
}

// BranchName returns the branch name for a given job ID.
func BranchName(jobID string) string {
	return "job/" + jobID
}

// CreateWorktree creates a git worktree for the given job ID.
// The worktree is created at .llmwiki/worktrees/<jobID>/ on a new branch job/<jobID>.
// Returns the worktree directory path.
func (r *GitRepo) CreateWorktree(jobID string) (string, error) {
	wtDir := r.WorktreeDir(jobID)
	branch := BranchName(jobID)

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(wtDir), 0o755); err != nil {
		return "", fmt.Errorf("create worktree parent dir: %w", err)
	}

	// Clean up any existing worktree/branch from a previous failed run
	_ = r.runGit("worktree", "remove", wtDir, "--force")
	_ = r.runGit("branch", "-D", branch)

	// Create worktree with a new branch from HEAD
	if err := r.runGit("worktree", "add", "-b", branch, wtDir, "HEAD"); err != nil {
		return "", fmt.Errorf("git worktree add: %w", err)
	}

	return wtDir, nil
}

// CommitInWorktree stages wiki/ changes and commits them in the given worktree directory.
// Returns the commit SHA. Skips commit if there are no changes.
func (r *GitRepo) CommitInWorktree(worktreeDir, message string) (string, error) {
	// git add wiki/ in worktree
	if err := r.runGitInDir(worktreeDir, "add", "wiki/"); err != nil {
		return "", fmt.Errorf("git add in worktree: %w", err)
	}

	// Check if there are staged changes
	hasChanges, err := r.hasStagedChangesInDir(worktreeDir)
	if err != nil {
		return "", fmt.Errorf("check staged changes in worktree: %w", err)
	}
	if !hasChanges {
		return "", nil // nothing to commit
	}

	// git commit
	if err := r.runGitInDir(worktreeDir, "commit", "-m", message); err != nil {
		return "", fmt.Errorf("git commit in worktree: %w", err)
	}

	return r.lastCommitSHAInDir(worktreeDir)
}

// MergeBranchResult contains the result of a merge operation.
type MergeBranchResult struct {
	Conflicts []string // list of conflicting file paths (empty if fast-forward or clean merge)
	FastForward bool   // true if the merge was a fast-forward
}

// MergeBranch merges the job branch back into the current branch (main).
// Returns conflict file paths if any.
func (r *GitRepo) MergeBranch(jobID string) (*MergeBranchResult, error) {
	branch := BranchName(jobID)

	// Try merge. If it succeeds, no conflicts.
	err := r.runGit("merge", branch)
	if err == nil {
		return &MergeBranchResult{FastForward: false}, nil
	}

	// Merge failed - check if it's due to conflicts
	// git ls-files -u lists unmerged files during a conflict
	out, err2 := r.gitOutput("ls-files", "-u", "--exclude-standard")
	if err2 != nil {
		// Not a conflict error, something else went wrong
		_ = r.runGit("merge", "--abort")
		return nil, fmt.Errorf("git merge %s: %w", branch, err)
	}

	// Parse unmerged files - extract unique paths
	seen := make(map[string]bool)
	var conflicts []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: <mode> <object> <stage> <path>
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) == 2 {
			path := parts[1]
			if !seen[path] {
				seen[path] = true
				conflicts = append(conflicts, path)
			}
		}
	}

	if len(conflicts) == 0 {
		// No conflicts but merge failed for other reasons
		_ = r.runGit("merge", "--abort")
		return nil, fmt.Errorf("git merge %s: %w", branch, err)
	}

	return &MergeBranchResult{Conflicts: conflicts}, nil
}

// GetConflictContent returns the ours and theirs content for a conflicting file.
// ours = content from main (stage 2), theirs = content from job branch (stage 3).
// Call during an active merge conflict (after MergeBranch returns conflicts).
func (r *GitRepo) GetConflictContent(jobID string, filePath string) (ours, theirs string, err error) {
	// During a merge conflict:
	//   :2:<file> = ours (current branch / main)
	//   :3:<file> = theirs (branch being merged / job)
	oursContent, oursErr := r.gitOutput("show", fmt.Sprintf(":2:%s", filePath))
	theirsContent, theirsErr := r.gitOutput("show", fmt.Sprintf(":3:%s", filePath))
	if oursErr != nil && theirsErr != nil {
		return "", "", fmt.Errorf("get conflict content for %s: ours: %v, theirs: %v", filePath, oursErr, theirsErr)
	}
	return oursContent, theirsContent, nil
}

// ResolveAndCommit resolves all conflicts with the given resolved file contents
// and completes the merge commit.
func (r *GitRepo) ResolveAndCommit(jobID string, resolved map[string]string, message string) error {
	// Write resolved content for each file
	for filePath, content := range resolved {
		fullPath := filepath.Join(r.workDir, filePath)
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			return fmt.Errorf("write resolved %s: %w", filePath, err)
		}
		if err := r.runGit("add", filePath); err != nil {
			return fmt.Errorf("git add resolved %s: %w", filePath, err)
		}
	}

	// Complete the merge commit
	if err := r.runGit("commit", "-m", message); err != nil {
		return fmt.Errorf("git merge commit: %w", err)
	}

	return nil
}

// AbortMerge aborts an in-progress merge.
func (r *GitRepo) AbortMerge() error {
	return r.runGit("merge", "--abort")
}

// RemoveWorktree cleans up the worktree directory and branch for a given job ID.
func (r *GitRepo) RemoveWorktree(jobID string) error {
	wtDir := r.WorktreeDir(jobID)
	branch := BranchName(jobID)

	var errs []string

	// Remove worktree
	if err := r.runGit("worktree", "remove", wtDir, "--force"); err != nil {
		errs = append(errs, fmt.Sprintf("remove worktree: %v", err))
	}

	// Delete branch
	if err := r.runGit("branch", "-d", branch); err != nil {
		// Branch might already be gone, that's ok
		_ = r.runGit("branch", "-D", branch)
	}

	if len(errs) > 0 {
		return fmt.Errorf("cleanup worktree: %s", strings.Join(errs, "; "))
	}
	return nil
}

// ListStaleWorktrees returns job IDs from worktree directories that exist under
// .llmwiki/worktrees/ but may need cleanup after a crash.
func (r *GitRepo) ListStaleWorktrees() ([]string, error) {
	wtBase := filepath.Join(r.workDir, ".llmwiki", "worktrees")
	entries, err := os.ReadDir(wtBase)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var ids []string
	for _, e := range entries {
		if e.IsDir() {
			ids = append(ids, e.Name())
		}
	}
	return ids, nil
}

// runGitInDir executes a git command in the specified directory.
func (r *GitRepo) runGitInDir(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
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

// hasStagedChangesInDir checks if there are staged changes in the specified directory.
func (r *GitRepo) hasStagedChangesInDir(dir string) (bool, error) {
	cmd := exec.Command("git", "diff", "--cached", "--quiet")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=llmwiki",
		"GIT_AUTHOR_EMAIL=llmwiki@local",
		"GIT_COMMITTER_NAME=llmwiki",
		"GIT_COMMITTER_EMAIL=llmwiki@local",
	)
	err := cmd.Run()
	if err != nil {
		return true, nil // diff --quiet exits 1 when there are changes
	}
	return false, nil
}

// lastCommitSHAInDir returns the SHA of the most recent commit in the specified directory.
func (r *GitRepo) lastCommitSHAInDir(dir string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=llmwiki",
		"GIT_AUTHOR_EMAIL=llmwiki@local",
		"GIT_COMMITTER_NAME=llmwiki",
		"GIT_COMMITTER_EMAIL=llmwiki@local",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
