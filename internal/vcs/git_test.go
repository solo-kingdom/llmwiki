package vcs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func createTempWorkspace(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "llmwiki-vcs-test-*")
	if err != nil {
		t.Fatal(err)
	}
	// Create wiki/ subdirectory
	if err := os.MkdirAll(filepath.Join(dir, "wiki"), 0o755); err != nil {
		os.RemoveAll(dir)
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

func TestIsGitAvailable(t *testing.T) {
	avail := IsGitAvailable()
	// In most test environments, git should be available
	if !avail.Available {
		t.Log("git is not available in this environment; skipping availability assertion")
		return
	}
	if avail.Version == "" {
		t.Error("expected non-empty version when git is available")
	}
}

func TestInitRepo(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)

	// Write a test wiki file
	wikiFile := filepath.Join(dir, "wiki", "test.md")
	if err := os.WriteFile(wikiFile, []byte("# Test\nHello"), 0o644); err != nil {
		t.Fatal(err)
	}

	repo, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	if !repo.IsInitialized() {
		t.Error("expected repo to be initialized")
	}

	// Check .gitignore
	gitignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(gitignore)
	for _, entry := range []string{".llmwiki/", "raw/", "revert/"} {
		if !strings.Contains(content, entry) {
			t.Errorf("expected .gitignore to contain %q", entry)
		}
	}

	// Check that we have an initial commit
	count, err := repo.CommitCount()
	if err != nil {
		t.Fatalf("CommitCount: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 commit, got %d", count)
	}
}

func TestInitRepoAlreadyInitialized(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)

	_, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("first InitRepo: %v", err)
	}

	// Second init should not fail
	repo, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("second InitRepo: %v", err)
	}

	count, err := repo.CommitCount()
	if err != nil {
		t.Fatalf("CommitCount: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 commit (no duplicate), got %d", count)
	}
}

func TestAddCommit(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	// Write a new wiki file
	wikiFile := filepath.Join(dir, "wiki", "page1.md")
	if err := os.WriteFile(wikiFile, []byte("# Page 1\nContent"), 0o644); err != nil {
		t.Fatal(err)
	}

	msg := BuildCommitMessage("test.pdf", "job-123", "upload", "normalized content here")
	sha, err := repo.AddCommit(msg)
	if err != nil {
		t.Fatalf("AddCommit: %v", err)
	}
	if sha == "" {
		t.Error("expected non-empty SHA")
	}

	count, _ := repo.CommitCount()
	if count != 2 {
		t.Errorf("expected 2 commits, got %d", count)
	}
}

func TestAddCommitNoChanges(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	sha, err := repo.AddCommit("no changes")
	if err != nil {
		t.Fatalf("AddCommit (no changes): %v", err)
	}
	if sha != "" {
		t.Errorf("expected empty SHA when no changes, got %q", sha)
	}
}

func TestLog(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	// Add a commit
	os.WriteFile(filepath.Join(dir, "wiki", "page.md"), []byte("# Page"), 0o644)
	repo.AddCommit(BuildCommitMessage("doc.pdf", "j1", "upload", "content"))

	entries, err := repo.Log(10)
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].SHA == "" {
		t.Error("expected non-empty SHA")
	}
	if entries[0].Subject == "" {
		t.Error("expected non-empty subject")
	}
}

func TestLogWithStats(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	os.WriteFile(filepath.Join(dir, "wiki", "page.md"), []byte("# Page"), 0o644)
	repo.AddCommit(BuildCommitMessage("doc.pdf", "j1", "upload", "content"))

	entries, err := repo.LogWithStats(10)
	if err != nil {
		t.Fatalf("LogWithStats: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	// The ingest commit should have at least 1 file changed
	if entries[0].FilesChanged < 1 {
		t.Errorf("expected at least 1 file changed, got %d", entries[0].FilesChanged)
	}
	// Root baseline commit is not an ingest change
	if entries[1].FilesChanged != 0 {
		t.Errorf("expected 0 files on initial commit, got %d", entries[1].FilesChanged)
	}
}

func TestDiffRootCommitEmpty(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	entries, err := repo.Log(1)
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}

	diff, err := repo.Diff(entries[0].SHA)
	if err != nil {
		t.Fatalf("Diff: %v", err)
	}
	if diff != "" {
		t.Errorf("expected empty diff for root commit, got %d bytes", len(diff))
	}
}

func TestDiff(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	os.WriteFile(filepath.Join(dir, "wiki", "page.md"), []byte("# Page"), 0o644)
	sha, _ := repo.AddCommit(BuildCommitMessage("doc.pdf", "j1", "upload", "content"))

	diff, err := repo.Diff(sha[:7])
	if err != nil {
		t.Fatalf("Diff: %v", err)
	}
	if diff == "" {
		t.Error("expected non-empty diff")
	}
	if !strings.Contains(diff, "page.md") {
		t.Error("expected diff to contain page.md")
	}
}

func TestShowMessage(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	os.WriteFile(filepath.Join(dir, "wiki", "page.md"), []byte("# Page"), 0o644)
	sha, _ := repo.AddCommit(BuildCommitMessage("doc.pdf", "job-123", "upload", "normalized text"))

	msg, err := repo.ShowMessage(sha[:7])
	if err != nil {
		t.Fatalf("ShowMessage: %v", err)
	}
	if msg.Source != "doc.pdf" {
		t.Errorf("expected source 'doc.pdf', got %q", msg.Source)
	}
	if msg.JobID != "job-123" {
		t.Errorf("expected job_id 'job-123', got %q", msg.JobID)
	}
	if msg.SourceType != "upload" {
		t.Errorf("expected source_type 'upload', got %q", msg.SourceType)
	}
	if !strings.Contains(msg.Normalized, "normalized text") {
		t.Errorf("expected normalized content to contain 'normalized text', got %q", msg.Normalized)
	}
}

func TestParseCommitMessage(t *testing.T) {
	raw := `ingest: paper.pdf

---META---
job_id: abc-123
source: paper.pdf
source_type: upload
---NORMALIZED-START---
This is the normalized content.
Multi-line content.
---NORMALIZED-END---`

	msg := parseCommitMessage(raw)
	if msg.Subject != "ingest: paper.pdf" {
		t.Errorf("subject: got %q", msg.Subject)
	}
	if msg.JobID != "abc-123" {
		t.Errorf("job_id: got %q", msg.JobID)
	}
	if msg.Source != "paper.pdf" {
		t.Errorf("source: got %q", msg.Source)
	}
	if msg.SourceType != "upload" {
		t.Errorf("source_type: got %q", msg.SourceType)
	}
	if !strings.Contains(msg.Normalized, "This is the normalized content") {
		t.Errorf("normalized: got %q", msg.Normalized)
	}
}

func TestParseCommitMessageNoMeta(t *testing.T) {
	raw := "initial: existing wiki\n"
	msg := parseCommitMessage(raw)
	if msg.Subject != "initial: existing wiki" {
		t.Errorf("subject: got %q", msg.Subject)
	}
	if msg.JobID != "" {
		t.Errorf("expected empty job_id, got %q", msg.JobID)
	}
	if msg.Normalized != "" {
		t.Errorf("expected empty normalized, got %q", msg.Normalized)
	}
}

func TestBuildCommitMessageTruncation(t *testing.T) {
	longContent := strings.Repeat("a", 2<<20) // > 1MB
	msg := BuildCommitMessage("big.pdf", "j1", "upload", longContent)
	if !strings.Contains(msg, "---NORMALIZED-TRUNCATED---") {
		t.Error("expected truncation marker for content > 1MB")
	}
}

func TestIsInitialized(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo := NewGitRepo(dir)

	if repo.IsInitialized() {
		t.Error("expected not initialized")
	}

	InitRepo(dir)

	if !repo.IsInitialized() {
		t.Error("expected initialized after InitRepo")
	}
}
