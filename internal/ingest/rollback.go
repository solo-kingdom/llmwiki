package ingest

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

// RollbackContext holds the data needed to perform a rollback.
type RollbackContext struct {
	Diff              string `json:"diff"`
	NormalizedContent string `json:"normalized_content"`
	AffectedFiles     []string `json:"affected_files"`
	SourceFilename    string `json:"source_filename"`
	CommitSHA         string `json:"commit_sha"`
}

// processRollbackJob handles a rollback-type ingest job.
// It reads the commit diff and normalized content, uses LLM to generate
// rollback content, writes wiki files, and creates a rollback commit.
func (p *JobProcessor) processRollbackJob(ctx context.Context, job *sqlite.IngestJob) error {
	repo := p.gitRepoIfEnabled()
	if repo == nil {
		return p.failJob(job.ID, "rollback_context_missing",
			"version control is not enabled", "", "")
	}

	// The source_ref field stores the target commit SHA
	commitSHA := job.SourceRef
	if commitSHA == "" {
		return p.failJob(job.ID, "rollback_context_missing",
			"no commit SHA specified for rollback", "", "")
	}

	// Get commit diff
	diff, err := repo.Diff(commitSHA)
	if err != nil {
		return p.failJob(job.ID, "rollback_context_missing",
			fmt.Sprintf("failed to get diff for commit %s: %v", commitSHA, err), "", "")
	}

	// Get commit message (contains normalized content)
	commitMsg, err := repo.ShowMessage(commitSHA)
	if err != nil {
		return p.failJob(job.ID, "rollback_context_missing",
			fmt.Sprintf("failed to get commit message for %s: %v", commitSHA, err), "", "")
	}

	if commitMsg.Normalized == "" {
		return p.failJob(job.ID, "rollback_context_missing",
			fmt.Sprintf("commit %s does not contain normalized content", commitSHA), "", "")
	}

	// Get list of affected files from the diff
	affectedFiles := parseDiffFiles(diff)

	// Read current content of affected wiki files
	currentFiles := make(map[string]string)
	for _, f := range affectedFiles {
		fullPath := filepath.Join(p.workspace, f)
		data, err := os.ReadFile(fullPath)
		if err != nil {
			if !os.IsNotExist(err) {
				log.Printf("rollback: warning: could not read %s: %v", f, err)
			}
			continue
		}
		currentFiles[f] = string(data)
	}

	// Build rollback context
	rbCtx := &RollbackContext{
		Diff:              diff,
		NormalizedContent: commitMsg.Normalized,
		AffectedFiles:     affectedFiles,
		SourceFilename:    commitMsg.Source,
		CommitSHA:         commitSHA,
	}

	// Execute rollback via LLM
	if err := p.preparePipelineForJob(job); err != nil {
		return err
	}
	if err := p.executeRollback(ctx, rbCtx, currentFiles); err != nil {
		return p.failJob(job.ID, "rollback_failed",
			fmt.Sprintf("LLM rollback failed: %v", err), "", "")
	}

	// Archive source file if it exists in raw/sources/
	p.archiveRollbackSource(rbCtx)

	// Git commit the rollback
	rollbackMsg := vcs.BuildRollbackCommitMessage(rbCtx.SourceFilename)
	sha, err := repo.AddCommit(rollbackMsg)
	if err != nil {
		return p.failJob(job.ID, "commit_failed",
			fmt.Sprintf("git commit after rollback failed: %v", err), "", "")
	}
	if sha != "" {
		_ = p.db.SetVCLastCommit(sha)
	}

	// Mark job succeeded
	summary := fmt.Sprintf("rolled back commit %s (%s)", commitSHA, rbCtx.SourceFilename)
	if _, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = ?, updated_at = datetime('now')
		WHERE id = ?`, summary, job.ID); updateErr != nil {
		log.Printf("rollback: failed to mark job %s succeeded: %v", job.ID, updateErr)
	}
	if updated, _ := p.db.GetIngestJob(job.ID); updated != nil {
		activity.LogIngestJob(p.db, updated, "succeeded", "processor")
	}
	activity.Record(p.db, activity.Entry{
		Level:        "info",
		Category:     "vcs",
		Action:       "rollback_succeeded",
		Message:      fmt.Sprintf("回滚成功：%s", commitSHA),
		ResourceType: "commit",
		ResourceID:   commitSHA,
		Status:       "success",
		Source:       "processor",
		Details: map[string]interface{}{
			"commit_sha": commitSHA,
			"job_id":     job.ID,
		},
	})

	return nil
}

// buildRollbackPrompt constructs the LLM prompt for rollback.
func buildRollbackPrompt(ctx *RollbackContext, currentFiles map[string]string) string {
	var sb strings.Builder

	sb.WriteString("You are performing a rollback of a wiki ingestion. ")
	sb.WriteString("Your task is to reverse the changes made by a previous ingest operation.\n\n")

	sb.WriteString("## The original diff (what was added/changed):\n")
	sb.WriteString("```\n")
	sb.WriteString(ctx.Diff)
	sb.WriteString("\n```\n\n")

	sb.WriteString("## Original source content that was ingested:\n")
	sb.WriteString("```\n")
	sb.WriteString(ctx.NormalizedContent)
	sb.WriteString("\n```\n\n")

	if len(currentFiles) > 0 {
		sb.WriteString("## Current wiki file contents:\n")
		for path, content := range currentFiles {
			sb.WriteString(fmt.Sprintf("### %s\n", path))
			sb.WriteString("```\n")
			sb.WriteString(content)
			sb.WriteString("\n```\n\n")
		}
	}

	sb.WriteString("Based on the diff and source content, generate the wiki files as they should be AFTER rollback. ")
	sb.WriteString("Remove any content that was added by this ingest, and restore any content that was modified or deleted.\n")
	sb.WriteString("Output FILE blocks: ---FILE: path\ncontent\n---END FILE---\n")
	sb.WriteString("If a file should be deleted entirely, output: ---FILE: path\n---DELETE---\n---END FILE---\n")

	return sb.String()
}

// executeRollback calls the LLM to generate rollback content and writes it to disk.
func (p *JobProcessor) executeRollback(ctx context.Context, rbCtx *RollbackContext, currentFiles map[string]string) error {
	if p.pipeline.llmClient == nil {
		return fmt.Errorf("LLM client not configured")
	}

	prompt := buildRollbackPrompt(rbCtx, currentFiles)

	messages := []llm.Message{
		{Role: "system", Content: "You are a wiki rollback assistant. Output FILE blocks to restore wiki content."},
		{Role: "user", Content: prompt},
	}

	ch, err := p.pipeline.llmClient.StreamChat(ctx, messages, 0.1, 8192)
	if err != nil {
		return fmt.Errorf("LLM stream: %w", err)
	}

	var result string
	for event := range ch {
		if event.Type == "token" {
			result += event.Content
		} else if event.Type == "error" {
			return fmt.Errorf("LLM error: %w", event.Error)
		}
	}

	// Parse FILE blocks and write/delete
	return p.applyRollbackContent(result)
}

// applyRollbackContent parses FILE blocks from LLM output and applies them.
func (p *JobProcessor) applyRollbackContent(output string) error {
	_, err := ApplyWikiBlocks(p.workspace, parseFileBlocksWithContent(output))
	return err
}

// archiveRollbackSource moves the raw source file to revert/ directory.
func (p *JobProcessor) archiveRollbackSource(ctx *RollbackContext) {
	if ctx.SourceFilename == "" {
		return
	}

	sourcePath := filepath.Join(p.workspace, "raw", "sources", ctx.SourceFilename)
	if _, err := os.Stat(sourcePath); os.IsNotExist(err) {
		return // source doesn't exist, skip
	}

	// Create revert directory
	revertDir := filepath.Join(p.workspace, "revert")
	if err := os.MkdirAll(revertDir, 0o755); err != nil {
		log.Printf("rollback: failed to create revert dir: %v", err)
		return
	}

	// Use short SHA (7 chars) for the filename
	shortSHA := ctx.CommitSHA
	if len(shortSHA) > 7 {
		shortSHA = shortSHA[:7]
	}
	destName := fmt.Sprintf("%s-%s", shortSHA, filepath.Base(ctx.SourceFilename))
	destPath := filepath.Join(revertDir, destName)

	if err := os.Rename(sourcePath, destPath); err != nil {
		log.Printf("rollback: failed to move source to revert: %v", err)
	}
}

// parseDiffFiles extracts file paths from a unified diff.
func parseDiffFiles(diff string) []string {
	var files []string
	seen := make(map[string]bool)
	for _, line := range strings.Split(diff, "\n") {
		if strings.HasPrefix(line, "+++ b/") {
			path := strings.TrimPrefix(line, "+++ b/")
			if path != "" && !seen[path] {
				seen[path] = true
				files = append(files, path)
			}
		} else if strings.HasPrefix(line, "diff --git a/") {
			// Alternative format: diff --git a/path b/path
			parts := strings.SplitN(line, " b/", 2)
			if len(parts) == 2 {
				path := parts[1]
				path = strings.TrimSpace(path)
				if path != "" && !seen[path] {
					seen[path] = true
					files = append(files, path)
				}
			}
		}
	}
	return files
}

