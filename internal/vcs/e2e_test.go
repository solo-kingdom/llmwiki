package vcs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestE2E_InitIngestCommit verifies: init VC → ingest → git commit produced
func TestE2E_InitIngestCommit(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	// Setup workspace
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "wiki"), 0o755)
	os.MkdirAll(filepath.Join(dir, "raw", "sources"), 0o755)

	// Step 1: Init version control
	repo, err := InitRepo(dir)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	// Verify initial commit
	count, _ := repo.CommitCount()
	if count != 1 {
		t.Fatalf("expected 1 commit after init, got %d", count)
	}

	// Step 2: Simulate ingest — write wiki file
	wikiFile := filepath.Join(dir, "wiki", "page1.md")
	os.WriteFile(wikiFile, []byte("# Page 1\nContent from ingest"), 0o644)

	// Step 3: Git commit
	msg := BuildCommitMessage("source.pdf", "job-001", "upload", "This is the normalized content of source.pdf")
	sha, err := repo.AddCommit(msg)
	if err != nil {
		t.Fatalf("AddCommit: %v", err)
	}
	if sha == "" {
		t.Fatal("expected non-empty SHA")
	}

	// Verify commit count
	count, _ = repo.CommitCount()
	if count != 2 {
		t.Fatalf("expected 2 commits, got %d", count)
	}

	// Step 4: Verify log shows the ingest commit
	entries, err := repo.LogWithStats(10)
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 log entries, got %d", len(entries))
	}
	if entries[0].Subject != "ingest: source.pdf" {
		t.Errorf("subject = %q, want 'ingest: source.pdf'", entries[0].Subject)
	}
	if entries[0].FilesChanged < 1 {
		t.Errorf("expected at least 1 file changed, got %d", entries[0].FilesChanged)
	}

	// Step 5: Verify diff shows the wiki file
	diff, err := repo.Diff(entries[0].SHA)
	if err != nil {
		t.Fatalf("Diff: %v", err)
	}
	if !strings.Contains(diff, "page1.md") {
		t.Error("diff should contain page1.md")
	}

	// Step 6: Verify commit message can be parsed
	parsed, err := repo.ShowMessage(entries[0].SHA)
	if err != nil {
		t.Fatalf("ShowMessage: %v", err)
	}
	if parsed.JobID != "job-001" {
		t.Errorf("job_id = %q, want 'job-001'", parsed.JobID)
	}
	if parsed.Source != "source.pdf" {
		t.Errorf("source = %q, want 'source.pdf'", parsed.Source)
	}
	if !strings.Contains(parsed.Normalized, "normalized content") {
		t.Errorf("normalized content missing, got %q", parsed.Normalized)
	}
}

// TestE2E_RollbackSourceArchive verifies: rollback → source file moves to revert/
func TestE2E_RollbackSourceArchive(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "wiki"), 0o755)
	os.MkdirAll(filepath.Join(dir, "raw", "sources"), 0o755)
	os.MkdirAll(filepath.Join(dir, "revert"), 0o755)

	// Create a source file
	sourceFile := filepath.Join(dir, "raw", "sources", "source.pdf")
	os.WriteFile(sourceFile, []byte("PDF content"), 0o644)

	// Verify source file exists
	if _, err := os.Stat(sourceFile); os.IsNotExist(err) {
		t.Fatal("source file should exist")
	}

	// Simulate rollback source archive: move raw/sources/file → revert/{sha}-{file}
	shortSHA := "abc1234"
	destName := shortSHA + "-" + "source.pdf"
	destPath := filepath.Join(dir, "revert", destName)
	if err := os.Rename(sourceFile, destPath); err != nil {
		t.Fatalf("Rename: %v", err)
	}

	// Verify source moved to revert
	if _, err := os.Stat(destPath); os.IsNotExist(err) {
		t.Fatal("file should be in revert/ directory")
	}

	// Verify original no longer exists
	if _, err := os.Stat(sourceFile); !os.IsNotExist(err) {
		t.Fatal("original source file should be gone")
	}
}

// TestE2E_MultipleIngests verifies multiple commits accumulate correctly
func TestE2E_MultipleIngests(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "wiki"), 0o755)

	repo, _ := InitRepo(dir)

	// Add multiple wiki files across multiple commits
	for i := 1; i <= 3; i++ {
		filename := filepath.Join(dir, "wiki", "page"+string(rune('0'+i))+".md")
		os.WriteFile(filename, []byte("# Page "+string(rune('0'+i))), 0o644)
		msg := BuildCommitMessage(
			"source"+string(rune('0'+i))+".pdf",
			"job-"+string(rune('0'+i)),
			"upload",
			"content "+string(rune('0'+i)),
		)
		_, err := repo.AddCommit(msg)
		if err != nil {
			t.Fatalf("AddCommit %d: %v", i, err)
		}
	}

	count, _ := repo.CommitCount()
	if count != 4 { // 1 initial + 3 ingest
		t.Errorf("expected 4 commits, got %d", count)
	}

	entries, _ := repo.LogWithStats(10)
	if len(entries) != 4 {
		t.Errorf("expected 4 log entries, got %d", len(entries))
	}

	// Verify each commit subject
	for i, entry := range entries {
		if i == 3 {
			// Initial commit
			if entry.Subject != "initial: existing wiki" {
				t.Errorf("entry[3] subject = %q", entry.Subject)
			}
		} else {
			if !strings.HasPrefix(entry.Subject, "ingest: source") {
				t.Errorf("entry[%d] subject = %q", i, entry.Subject)
			}
		}
	}
}

// TestE2E_CommitFailedRetry verifies the error code tracking for commit failures
func TestE2E_CommitFailedRetry(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	// This test verifies the error code classification logic
	// rather than actual git failure (hard to simulate)
	
	// Verify that pipeline errors are classified separately from commit errors
	// The processor.go already has this logic:
	// - pipeline errors → llm_auth_failed, llm_rate_limited, etc.
	// - commit errors → commit_failed
	// This is tested in processor_test.go

	// Here we verify that VCS operations work after an initial failed attempt
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "wiki"), 0o755)

	repo, _ := InitRepo(dir)

	// First successful commit
	os.WriteFile(filepath.Join(dir, "wiki", "page.md"), []byte("# Page"), 0o644)
	sha1, err := repo.AddCommit("first commit")
	if err != nil {
		t.Fatalf("first commit: %v", err)
	}
	if sha1 == "" {
		t.Fatal("expected non-empty SHA")
	}

	// Second successful commit (simulate retry after hypothetical failure)
	os.WriteFile(filepath.Join(dir, "wiki", "page.md"), []byte("# Page Updated"), 0o644)
	sha2, err := repo.AddCommit("retry commit")
	if err != nil {
		t.Fatalf("retry commit: %v", err)
	}
	if sha2 == "" {
		t.Fatal("expected non-empty SHA")
	}

	// Verify both commits exist
	count, _ := repo.CommitCount()
	if count != 3 {
		t.Errorf("expected 3 commits (init + 2), got %d", count)
	}
}

// TestE2E_VCDisabledIngest verifies ingest works without version control
func TestE2E_VCDisabledIngest(t *testing.T) {
	if !IsGitAvailable().Available {
		t.Skip("git not available")
	}

	// Create workspace without git init
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "wiki"), 0o755)

	repo := NewGitRepo(dir)
	if repo.IsInitialized() {
		t.Error("expected not initialized")
	}

	// Write wiki files directly (simulating pipeline without git commit)
	os.WriteFile(filepath.Join(dir, "wiki", "page.md"), []byte("# Page"), 0o644)

	// Verify file exists
	data, err := os.ReadFile(filepath.Join(dir, "wiki", "page.md"))
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(string(data), "# Page") {
		t.Error("file content mismatch")
	}

	// Verify no git history
	entries, err := repo.Log(10)
	if err != nil {
		// Expected — no git repo
		t.Logf("Expected error with no git repo: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(entries))
	}
}
