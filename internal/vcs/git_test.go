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
	for _, entry := range FineGrainedGitignoreEntries {
		if !strings.Contains(content, entry) {
			t.Errorf("expected .gitignore to contain %q", entry)
		}
	}
	if strings.Contains(content, ".llmwiki/\n") || strings.TrimSpace(content) == ".llmwiki/" {
		t.Error("expected legacy .llmwiki/ blanket ignore to be migrated away")
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

func TestCreateWorktree(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	// Put a file in wiki/ so git tracks it
	os.WriteFile(filepath.Join(dir, "wiki", "index.md"), []byte("# Index"), 0o644)
	repo, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	// Create a worktree
	wtDir, err := repo.CreateWorktree("test-job-1")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	if wtDir == "" {
		t.Fatal("expected non-empty worktree dir")
	}

	// Verify worktree directory exists
	if _, err := os.Stat(wtDir); os.IsNotExist(err) {
		t.Fatalf("worktree dir %s does not exist", wtDir)
	}

	// Verify wiki/ exists in worktree
	if _, err := os.Stat(filepath.Join(wtDir, "wiki")); os.IsNotExist(err) {
		t.Error("expected wiki/ directory in worktree")
	}

	// Cleanup
	if err := repo.RemoveWorktree("test-job-1"); err != nil {
		t.Fatalf("RemoveWorktree: %v", err)
	}

	// Verify worktree removed
	if _, err := os.Stat(wtDir); !os.IsNotExist(err) {
		t.Error("expected worktree dir to be removed")
	}
}

func TestCommitInWorktree(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	os.WriteFile(filepath.Join(dir, "wiki", "index.md"), []byte("# Index"), 0o644)
	repo, _ := InitRepo(dir)

	wtDir, err := repo.CreateWorktree("test-commit-wt")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	defer repo.RemoveWorktree("test-commit-wt")

	// Write a file in the worktree
	wikiFile := filepath.Join(wtDir, "wiki", "newpage.md")
	if err := os.MkdirAll(filepath.Dir(wikiFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wikiFile, []byte("# New Page\nContent"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Commit in worktree
	sha, err := repo.CommitInWorktree(wtDir, "test: worktree commit")
	if err != nil {
		t.Fatalf("CommitInWorktree: %v", err)
	}
	if sha == "" {
		t.Error("expected non-empty SHA")
	}
}

func TestMergeBranch(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	os.WriteFile(filepath.Join(dir, "wiki", "index.md"), []byte("# Index"), 0o644)
	repo, _ := InitRepo(dir)

	// Create worktree, write new file, commit
	wtDir, err := repo.CreateWorktree("test-merge")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	defer repo.RemoveWorktree("test-merge")

	os.WriteFile(filepath.Join(wtDir, "wiki", "merged.md"), []byte("# Merged"), 0o644)
	repo.CommitInWorktree(wtDir, "test: merge this")

	// Merge back
	result, err := repo.MergeBranch("test-merge")
	if err != nil {
		t.Fatalf("MergeBranch: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if len(result.Conflicts) != 0 {
		t.Errorf("expected no conflicts, got %v", result.Conflicts)
	}

	// Verify file exists in main (merge auto-commits)
	content, err := os.ReadFile(filepath.Join(dir, "wiki", "merged.md"))
	if err != nil {
		t.Fatalf("merged file should exist: %v", err)
	}
	if string(content) != "# Merged" {
		t.Errorf("merged content = %q, want %q", string(content), "# Merged")
	}
}

func TestMergeBranchWithConflict(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	os.WriteFile(filepath.Join(dir, "wiki", "conflict.md"), []byte("original"), 0o644)
	repo, _ := InitRepo(dir)

	// Modify in main after worktree creation point
	// First create worktree from current HEAD
	wtDir, err := repo.CreateWorktree("test-conflict")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	defer repo.RemoveWorktree("test-conflict")

	// Modify same file in main
	os.WriteFile(filepath.Join(dir, "wiki", "conflict.md"), []byte("main version"), 0o644)
	repo.AddCommit(BuildCommitMessage("main.md", "j-main", "upload", "main"))

	// Modify in worktree
	os.WriteFile(filepath.Join(wtDir, "wiki", "conflict.md"), []byte("branch version"), 0o644)
	repo.CommitInWorktree(wtDir, "test: conflicting change")

	// Merge should detect conflict
	result, err := repo.MergeBranch("test-conflict")
	if err != nil {
		t.Fatalf("MergeBranch: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if len(result.Conflicts) == 0 {
		t.Error("expected conflicts")
	}
	// Verify it's the file we expect
	found := false
	for _, c := range result.Conflicts {
		if c == "wiki/conflict.md" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected wiki/conflict.md in conflicts, got %v", result.Conflicts)
	}

	// Abort the merge to clean up
	if err := repo.AbortMerge(); err != nil {
		t.Logf("AbortMerge: %v (may be ok)", err)
	}
}

func TestGetConflictContent(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	os.WriteFile(filepath.Join(dir, "wiki", "both.md"), []byte("original"), 0o644)
	repo, _ := InitRepo(dir)

	// Create worktree, then modify in both branches
	wtDir, err := repo.CreateWorktree("test-content")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	defer repo.RemoveWorktree("test-content")

	// Modify in main
	os.WriteFile(filepath.Join(dir, "wiki", "both.md"), []byte("main content"), 0o644)
	repo.AddCommit(BuildCommitMessage("both.md", "j-main", "upload", "main"))

	// Modify in worktree
	os.WriteFile(filepath.Join(wtDir, "wiki", "both.md"), []byte("branch content"), 0o644)
	repo.CommitInWorktree(wtDir, "test: different content")

	// Start merge
	result, err := repo.MergeBranch("test-content")
	if err != nil {
		t.Fatalf("MergeBranch: %v", err)
	}
	if len(result.Conflicts) == 0 {
		t.Fatal("expected conflicts")
	}

	// Get conflict content using stage syntax
	ours, theirs, err := repo.GetConflictContent("test-content", "wiki/both.md")
	if err != nil {
		t.Fatalf("GetConflictContent: %v", err)
	}

	t.Logf("ours=%q, theirs=%q", ours, theirs)

	// At minimum one should be non-empty if conflict exists
	if ours == "" && theirs == "" {
		t.Error("expected at least one non-empty content for conflicting file")
	}

	// Abort to clean up
	repo.AbortMerge()
}

func TestResolveAndCommit(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	os.WriteFile(filepath.Join(dir, "wiki", "resolve.md"), []byte("original"), 0o644)
	repo, _ := InitRepo(dir)

	// Create worktree, modify in both branches
	wtDir, err := repo.CreateWorktree("test-resolve")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	defer repo.RemoveWorktree("test-resolve")

	// Modify in main
	os.WriteFile(filepath.Join(dir, "wiki", "resolve.md"), []byte("main version"), 0o644)
	repo.AddCommit(BuildCommitMessage("resolve.md", "j-main", "upload", "main"))

	// Modify in worktree
	os.WriteFile(filepath.Join(wtDir, "wiki", "resolve.md"), []byte("branch version"), 0o644)
	repo.CommitInWorktree(wtDir, "test: conflicting")

	// Merge (will conflict)
	result, err := repo.MergeBranch("test-resolve")
	if err != nil {
		t.Fatalf("MergeBranch: %v", err)
	}
	if len(result.Conflicts) == 0 {
		t.Fatal("expected conflicts")
	}

	// Resolve
	resolved := map[string]string{
		"wiki/resolve.md": "resolved content\n",
	}
	if err := repo.ResolveAndCommit("test-resolve", resolved, "merge: resolved conflict"); err != nil {
		t.Fatalf("ResolveAndCommit: %v", err)
	}

	// Verify resolved content
	content, err := os.ReadFile(filepath.Join(dir, "wiki", "resolve.md"))
	if err != nil {
		t.Fatalf("file should exist: %v", err)
	}
	if string(content) != "resolved content\n" {
		t.Errorf("content = %q, want %q", string(content), "resolved content\n")
	}
}

func TestListStaleWorktrees(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	// No worktrees initially
	ids, err := repo.ListStaleWorktrees()
	if err != nil {
		t.Fatalf("ListStaleWorktrees: %v", err)
	}
	if len(ids) != 0 {
		t.Errorf("expected 0 stale worktrees, got %d", len(ids))
	}

	// Create a worktree
	repo.CreateWorktree("stale-1")
	defer repo.RemoveWorktree("stale-1")

	ids, err = repo.ListStaleWorktrees()
	if err != nil {
		t.Fatalf("ListStaleWorktrees: %v", err)
	}
	if len(ids) != 1 || ids[0] != "stale-1" {
		t.Errorf("expected [stale-1], got %v", ids)
	}
}

func TestRecreateWorktreeAfterFailed(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, _ := InitRepo(dir)

	// Create worktree
	wtDir, err := repo.CreateWorktree("retry-job")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	if _, err := os.Stat(wtDir); os.IsNotExist(err) {
		t.Fatal("worktree should exist")
	}

	// Don't clean up properly (simulate crash) - just leave it
	// Now try to create again - should succeed by cleaning up first
	wtDir2, err := repo.CreateWorktree("retry-job")
	if err != nil {
		t.Fatalf("CreateWorktree (retry): %v", err)
	}
	if wtDir2 != wtDir {
		t.Errorf("wtDir2 = %q, want %q", wtDir2, wtDir)
	}

	// Clean up
	repo.RemoveWorktree("retry-job")
}

func TestBackupCommitAndLogIngestOnly(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	os.WriteFile(filepath.Join(dir, "wiki", "a.md"), []byte("# A"), 0o644)
	os.WriteFile(filepath.Join(dir, "purpose.md"), []byte("# Purpose"), 0o644)

	repo, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	os.WriteFile(filepath.Join(dir, "wiki", "b.md"), []byte("# B"), 0o644)
	if _, err := repo.AddCommit("ingest: test.pdf"); err != nil {
		t.Fatalf("AddCommit: %v", err)
	}
	if _, err := repo.BackupCommit(true); err != nil {
		t.Fatalf("BackupCommit: %v", err)
	}

	all, err := repo.LogWithStats(10)
	if err != nil {
		t.Fatalf("LogWithStats: %v", err)
	}
	if len(all) < 2 {
		t.Fatalf("expected at least 2 commits, got %d", len(all))
	}

	ingestOnly, err := repo.LogIngestOnly(10)
	if err != nil {
		t.Fatalf("LogIngestOnly: %v", err)
	}
	for _, e := range ingestOnly {
		if !IsIngestCommitSubject(e.Subject) {
			t.Errorf("unexpected subject in ingest log: %q", e.Subject)
		}
	}
	foundIngest := false
	for _, e := range ingestOnly {
		if strings.HasPrefix(e.Subject, "ingest:") {
			foundIngest = true
		}
	}
	if !foundIngest {
		t.Error("expected ingest commit in filtered log")
	}
}

func TestSetRemote(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := createTempWorkspace(t)
	repo, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	url := "https://example.com/user/repo.git"
	if err := repo.SetRemote(url); err != nil {
		t.Fatalf("SetRemote: %v", err)
	}
	st, err := repo.RemoteStatus()
	if err != nil {
		t.Fatalf("RemoteStatus: %v", err)
	}
	if !st.Configured || st.URL != url {
		t.Errorf("remote status = %+v, want URL %q", st, url)
	}
}
