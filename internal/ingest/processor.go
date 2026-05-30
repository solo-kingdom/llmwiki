package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

// JobProcessor polls the database for queued ingest jobs and runs them
// through the two-step LLM pipeline (analysis → generation).
//
// When parallel execution is enabled (VCS + git worktree), jobs run concurrently
// in isolated worktrees and merge back serially. Otherwise, jobs run serially.
type JobProcessor struct {
	db        *sqlite.DB
	workspace string
	pipeline  *Pipeline
	gitRepo   *vcs.GitRepo // nil when workspace has no .git repository
	indexer   *engine.WorkspaceFileIndexer
	stop      chan struct{}
	runnerID  string

	// Parallel execution
	mergeQueue chan *completedJob
	workers    sync.WaitGroup
}

// completedJob represents a job that has finished pipeline execution in a worktree
// and is ready to be merged back to main.
type completedJob struct {
	jobID       string
	worktreeDir string
	sourcePath  string
	files       []string
	normalized  *NormalizedSource
	recorder    JobRecorder
}

func newRunnerID() string {
	host, _ := os.Hostname()
	if host == "" {
		host = "local"
	}
	return fmt.Sprintf("%s-%d-%s", host, os.Getpid(), uuid.New().String()[:8])
}

// NewJobProcessor creates a new processor. It needs the main DB (not the
// legacy queue DB) so it can read/write the unified ingest_jobs table.
func NewJobProcessor(db *sqlite.DB, workspace string) *JobProcessor {
	return &JobProcessor{
		db:        db,
		workspace: workspace,
		pipeline:  NewPipelineWithDB(workspace, db, nil),
		stop:      make(chan struct{}),
		runnerID:  newRunnerID(),
	}
}

// SetGitRepo sets an optional git repo override (mainly for tests).
// Production code resolves the repo at runtime via gitRepoIfEnabled.
func (p *JobProcessor) SetGitRepo(repo *vcs.GitRepo) {
	p.gitRepo = repo
}

// gitRepoIfEnabled returns a GitRepo when the workspace has an initialized .git directory.
func (p *JobProcessor) gitRepoIfEnabled() *vcs.GitRepo {
	if p.gitRepo != nil {
		return p.gitRepo
	}
	repo := vcs.NewGitRepo(p.workspace)
	if !repo.IsInitialized() {
		return nil
	}
	return repo
}

// SetFileIndexer sets the workspace file indexer for post-ingest search indexing.
func (p *JobProcessor) SetFileIndexer(indexer *engine.WorkspaceFileIndexer) {
	p.indexer = indexer
}

// Start begins the background processing loop. It polls every pollInterval.
// When parallel execution is enabled (VCS + git), launches a worker pool and merge queue.
// Otherwise falls back to serial single-goroutine processing.
func (p *JobProcessor) Start(pollInterval time.Duration) {
	if pollInterval <= 0 {
		pollInterval = 3 * time.Second
	}
	p.recoverStaleJobs()

	if p.parallelEnabled() {
		p.startParallel(pollInterval)
	} else {
		p.startSerial(pollInterval)
	}
}

// parallelEnabled reports whether parallel worktree-based execution should be used.
func (p *JobProcessor) parallelEnabled() bool {
	return p.db.ParallelEnabled() && p.gitRepoIfEnabled() != nil
}

// startSerial launches a single goroutine that processes jobs one at a time.
func (p *JobProcessor) startSerial(pollInterval time.Duration) {
	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-p.stop:
				return
			case <-ticker.C:
				if err := p.processNext(context.Background()); err != nil {
					log.Printf("ingest processor: %v", err)
				}
			}
		}
	}()
}

// startParallel launches N worker goroutines and a merge queue goroutine.
func (p *JobProcessor) startParallel(pollInterval time.Duration) {
	maxWorkers := p.db.MaxConcurrentJobs()
	p.mergeQueue = make(chan *completedJob, maxWorkers)

	// Start merger goroutine (serial merge back to main)
	p.workers.Add(1)
	go func() {
		defer p.workers.Done()
		p.mergerLoop()
	}()

	// Start worker goroutines
	for i := 0; i < maxWorkers; i++ {
		p.workers.Add(1)
		go func(workerID int) {
			defer p.workers.Done()
			p.workerLoop(pollInterval, workerID)
		}(i)
	}

	log.Printf("ingest processor: parallel mode enabled (%d workers)", maxWorkers)
}

// workerLoop polls for jobs and executes them in worktrees.
func (p *JobProcessor) workerLoop(pollInterval time.Duration, workerID int) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			job, err := p.claimNextJob()
			if err != nil {
				log.Printf("worker %d: claim error: %v", workerID, err)
				continue
			}
			if job == nil {
				continue // no queued jobs
			}

			p.processJobInWorktree(context.Background(), job, workerID)
		}
	}
}

// mergerLoop processes completed jobs from the merge queue, merging them
// back to main and updating the search index.
func (p *JobProcessor) mergerLoop() {
	for {
		select {
		case <-p.stop:
			return
		case completed := <-p.mergeQueue:
			if completed == nil {
				return
			}
			p.mergeCompletedJob(context.Background(), completed)
		}
	}
}

// Stop signals the processor to stop and waits for workers to finish.
func (p *JobProcessor) Stop() {
	close(p.stop)
	p.workers.Wait()
}

// ProcessAll runs all queued jobs synchronously (useful for tests).
func (p *JobProcessor) ProcessAll(ctx context.Context) error {
	for {
		if err := p.processNext(ctx); err != nil {
			if strings.Contains(err.Error(), "no queued jobs") {
				return nil
			}
			return err
		}
	}
}

// processNext claims the next queued job and runs it through the pipeline.
func (p *JobProcessor) processNext(ctx context.Context) error {
	job, err := p.claimNextJob()
	if err != nil {
		return err
	}
	if job == nil {
		return fmt.Errorf("no queued jobs")
	}

	stopHeartbeat := p.startHeartbeat(job.ID)
	defer stopHeartbeat()

	rec := NewSQLiteJobRecorder(p.db, job.ID)
	p.pipeline.SetJobRecorder(rec)
	defer p.pipeline.SetJobRecorder(nil)

	defer p.db.ClearIngestJobLease(job.ID)

	// Check if this is a rollback job
	if job.InputType == "rollback" {
		return p.processRollbackJob(ctx, job)
	}

	if job.InputType == string(InputKindReviewPlan) {
		return p.processReviewPlanJob(ctx, job)
	}
	if job.InputType == string(InputKindReviewApply) {
		return p.processReviewApplyJob(ctx, job)
	}

	// Check if this is a commit_failed retry — skip pipeline, just redo git commit
	if job.ErrorCode == "commit_failed" {
		return p.retryCommitOnly(job)
	}

	normalized, err := NormalizeJobSource(p.workspace, job.InputType, job.SourcePath, job.SourceRef)
	if err != nil {
		return p.failJob(job.ID, "normalize_failed",
			fmt.Sprintf("normalization failed: %v", err), "", "")
	}

	if err := p.preparePipelineForJob(job); err != nil {
		return err
	}
	defer p.pipeline.SetMCPRouter(nil)
	p.checkRulesDrift(job.ID)

	// Run through the two-step LLM pipeline
	files, err := p.pipeline.IngestNormalized(ctx, normalized)
	if err != nil {
		errCode := classifyPipelineError(err)
		return p.failJob(job.ID, errCode, err.Error(), "", remediationForCode(errCode))
	}

	// Git commit (if version control is enabled)
	p.finalizeWikiApply(job.ID, job.SourcePath, "", ApplyWikiResult{Written: files})

	if repo := p.gitRepoIfEnabled(); repo != nil {
		commitMsg := vcs.BuildCommitMessage(
			filepath.Base(normalized.CanonicalPath),
			job.ID,
			job.InputType,
			string(normalized.Content),
		)
		sha, err := repo.AddCommit(commitMsg)
		if err != nil {
			rec.Record("git_commit", "error", err.Error(), map[string]any{"message": commitMsg})
			return p.failJob(job.ID, "commit_failed",
				fmt.Sprintf("git commit failed: %v", err), "", "")
		}
		rec.Record("git_commit", "complete", "git commit succeeded", map[string]any{
			"sha":     sha,
			"message": commitMsg,
		})
		// Store last commit SHA
		if sha != "" {
			_ = p.db.SetVCLastCommit(sha)
		}
		vcs.TryAutoPush(repo, p.db)
	}

	// Mark job succeeded
	p.markJobSucceeded(job.ID, files)

	return nil
}

// processJobInWorktree runs a job in an isolated git worktree.
// After the pipeline completes, it commits to the job branch and sends
// the result to the merge queue.
func (p *JobProcessor) processJobInWorktree(ctx context.Context, job *sqlite.IngestJob, workerID int) {
	repo := p.gitRepoIfEnabled()
	if repo == nil {
		// VCS disabled during execution, fall back to serial path
		p.processNext(ctx)
		return
	}

	stopHeartbeat := p.startHeartbeat(job.ID)
	defer stopHeartbeat()

	rec := NewSQLiteJobRecorder(p.db, job.ID)
	defer p.db.ClearIngestJobLease(job.ID)

	// Create worktree
	worktreeDir, err := repo.CreateWorktree(job.ID)
	if err != nil {
		log.Printf("worker %d: create worktree for job %s: %v", workerID, job.ID, err)
		_ = p.failJob(job.ID, "worktree_failed",
			fmt.Sprintf("failed to create worktree: %v", err), "", "")
		return
	}

	// Ensure cleanup on error
	cleanup := true
	defer func() {
		if cleanup {
			if err := repo.RemoveWorktree(job.ID); err != nil {
				log.Printf("worker %d: cleanup worktree for job %s: %v", workerID, job.ID, err)
			}
		}
	}()

	// Normalize source
	normalized, err := NormalizeJobSource(p.workspace, job.InputType, job.SourcePath, job.SourceRef)
	if err != nil {
		_ = p.failJob(job.ID, "normalize_failed",
			fmt.Sprintf("normalization failed: %v", err), "", "")
		return
	}

	// Create a per-job pipeline pointing to the worktree
	jobPipeline := NewPipelineWithDB(worktreeDir, p.db, nil)
	jobPipeline.SetJobRecorder(rec)
	jobPipeline.SetTargetDir(worktreeDir)

	// Prepare LLM client and settings
	client, err := p.resolveLLMClientForJob(job)
	if err != nil {
		_ = p.failJob(job.ID, "llm_config_invalid", err.Error(), "", remediationForCode("llm_config_invalid"))
		return
	}
	jobPipeline.SetLLMClient(client)
	docLang := resolveDocLang(p.db)
	jobPipeline.SetDocLanguage(docLang)
	jobPipeline.SetRulesSupplement(ResolveRulesSupplement(p.db))

	// Attach MCP router
	raw, _ := p.db.GetConfig("mcp_servers_json")
	if reg, regErr := mcp.NewRegistry(raw); regErr == nil {
		router := mcp.NewRouter(reg, &mcpRecorderAdapter{jobRec: rec, db: p.db})
		jobPipeline.SetMCPRouter(router)
		defer jobPipeline.SetMCPRouter(nil)
	}

	// Run pipeline
	files, err := jobPipeline.IngestNormalized(ctx, normalized)
	if err != nil {
		errCode := classifyPipelineError(err)
		_ = p.failJob(job.ID, errCode, err.Error(), "", remediationForCode(errCode))
		return
	}

	// Rebuild wiki/index.md in the worktree before commit.
	p.runPostApplyMaintenance(worktreeDir, job.SourcePath, "", ApplyWikiResult{Written: files}, nil)

	// Commit in worktree
	commitMsg := vcs.BuildCommitMessage(
		filepath.Base(normalized.CanonicalPath),
		job.ID,
		job.InputType,
		string(normalized.Content),
	)
	sha, err := repo.CommitInWorktree(worktreeDir, commitMsg)
	if err != nil {
		rec.Record("git_commit", "error", err.Error(), map[string]any{"message": commitMsg})
		_ = p.failJob(job.ID, "commit_failed",
			fmt.Sprintf("worktree commit failed: %v", err), "", "")
		return
	}
	rec.Record("git_commit", "complete", "worktree commit succeeded", map[string]any{
		"sha":     sha,
		"message": commitMsg,
	})

	// Submit to merge queue (cleanup will happen in merger)
	cleanup = false
	p.mergeQueue <- &completedJob{
		jobID:       job.ID,
		worktreeDir: worktreeDir,
		sourcePath:  job.SourcePath,
		files:       files,
		normalized:  normalized,
		recorder:    rec,
	}
}

// mergeWorktreeJobBranch merges a completed job branch into main, resolves conflicts,
// updates the search index, and returns the resulting merge commit SHA.
func (p *JobProcessor) mergeWorktreeJobBranch(
	ctx context.Context,
	repo *vcs.GitRepo,
	jobID string,
	files []string,
	llmClient *llm.Client,
	rec JobRecorder,
) (string, error) {
	if _, err := repo.CommitWikiMaintenance(wikiMaintenanceCommitMsg); err != nil {
		return "", fmt.Errorf("commit pending wiki maintenance: %w", err)
	}

	result, err := repo.MergeBranch(jobID)
	if err != nil {
		_ = repo.AbortMerge()
		return "", fmt.Errorf("merge failed: %w", err)
	}

	if len(result.Conflicts) > 0 {
		mc := &vcs.MergeConflictContext{
			LLMClient: llmClient,
			DocLang:   resolveDocLang(p.db),
		}
		if err := vcs.ResolveMergeConflicts(ctx, repo, jobID, mc); err != nil {
			_ = repo.AbortMerge()
			return "", fmt.Errorf("LLM conflict resolution failed: %w", err)
		}
		if rec != nil {
			rec.Record("merge", "complete",
				fmt.Sprintf("LLM resolved %d conflict(s)", len(result.Conflicts)),
				map[string]any{"conflicts": result.Conflicts})
		}
	}

	sha, err := repo.LastCommitSHA()
	if err != nil {
		return "", err
	}
	if sha != "" {
		_ = p.db.SetVCLastCommit(sha)
	}
	vcs.TryAutoPush(repo, p.db)

	p.indexGeneratedWikiFiles(files, jobID)
	return sha, nil
}

// mergeCompletedJob merges a completed job's worktree branch back to main,
// handles conflicts with LLM resolution, updates the search index, and
// marks the job as succeeded.
func (p *JobProcessor) mergeCompletedJob(ctx context.Context, completed *completedJob) {
	repo := p.gitRepoIfEnabled()
	if repo == nil {
		p.markJobSucceeded(completed.jobID, completed.files)
		return
	}

	llmClient, _ := p.resolveLLMClientForJob(&sqlite.IngestJob{ID: completed.jobID})
	sha, err := p.mergeWorktreeJobBranch(ctx, repo, completed.jobID, completed.files, llmClient, completed.recorder)
	if err != nil {
		log.Printf("merger: merge failed for job %s: %v", completed.jobID, err)
		errCode := "merge_failed"
		if strings.Contains(err.Error(), "conflict resolution") {
			errCode = "merge_conflict"
		}
		_ = p.failJob(completed.jobID, errCode, err.Error(), "", "")
		_ = repo.RemoveWorktree(completed.jobID)
		return
	}

	if sha != "" && completed.recorder != nil {
		completed.recorder.Record("git_commit", "complete", "merged to main", map[string]any{"sha": sha})
	}

	p.finalizeWikiApply(completed.jobID, completed.sourcePath, "", ApplyWikiResult{Written: completed.files})

	p.markJobSucceeded(completed.jobID, completed.files)

	if err := repo.RemoveWorktree(completed.jobID); err != nil {
		log.Printf("merger: cleanup worktree for job %s: %v", completed.jobID, err)
	}
}

// markJobSucceeded marks a job as succeeded with a result summary.
func (p *JobProcessor) markJobSucceeded(jobID string, files []string) {
	summary := fmt.Sprintf("generated %d wiki page(s)", len(files))
	if _, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = ?,
		    runner_id = '', heartbeat_at = '', updated_at = datetime('now')
		WHERE id = ?`, summary, jobID); updateErr != nil {
		log.Printf("processor: failed to mark job %s succeeded: %v", jobID, updateErr)
	}
	if updated, _ := p.db.GetIngestJob(jobID); updated != nil {
		activity.LogIngestJob(p.db, updated, "succeeded", "processor")
		p.logSessionArchiveOutcome(updated, "archive_succeeded", "success")
	}
}

// retryCommitOnly retries only the git commit for a job that previously failed at the commit stage.
func (p *JobProcessor) retryCommitOnly(job *sqlite.IngestJob) error {
	repo := p.gitRepoIfEnabled()
	if repo == nil {
		// Version control was disabled, just mark as succeeded
		_, err := p.db.DB().Exec(`
			UPDATE ingest_jobs
			SET status = 'succeeded', updated_at = datetime('now')
			WHERE id = ?`, job.ID)
		return err
	}

	commitMsg := vcs.BuildCommitMessage(
		filepath.Base(job.SourcePath),
		job.ID,
		"upload", // retry jobs may not preserve original input_type; use a default
		"",
	)
	sha, err := repo.AddCommit(commitMsg)
	if err != nil {
		return p.failJob(job.ID, "commit_failed",
			fmt.Sprintf("git commit retry failed: %v", err), "", "")
	}
	if sha != "" {
		_ = p.db.SetVCLastCommit(sha)
	}
	vcs.TryAutoPush(repo, p.db)

	_, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = 'commit retry succeeded', updated_at = datetime('now')
		WHERE id = ?`, job.ID)
	return updateErr
}

func (p *JobProcessor) recoverStaleJobs() {
	// Recover stale running jobs (heartbeat expired)
	ids, err := p.db.RecoverStaleRunningJobs()
	if err != nil {
		log.Printf("ingest processor: recover stale: %v", err)
		return
	}
	for _, id := range ids {
		rec := NewSQLiteJobRecorder(p.db, id)
		rec.Record("system", "stale_recovered", "job requeued after heartbeat timeout", map[string]any{
			"threshold_seconds": sqlite.StaleHeartbeatSeconds,
		})
	}

	// Clean up residual worktrees from crashed jobs
	p.cleanupStaleWorktrees()
}

// cleanupStaleWorktrees removes worktree directories left behind by crashed processes.
func (p *JobProcessor) cleanupStaleWorktrees() {
	repo := p.gitRepoIfEnabled()
	if repo == nil {
		return
	}

	staleIDs, err := repo.ListStaleWorktrees()
	if err != nil {
		log.Printf("ingest processor: list stale worktrees: %v", err)
		return
	}
	if len(staleIDs) == 0 {
		return
	}

	for _, jobID := range staleIDs {
		// Check if the job is still running with a valid heartbeat
		job, err := p.db.GetIngestJob(jobID)
		if err != nil {
			log.Printf("ingest processor: check stale worktree job %s: %v", jobID, err)
			// Can't look up job, clean up worktree anyway
		}

		// If job exists and is running, recover it first
		if job != nil && job.Status == "running" {
			// Force recover: clear runner, set to queued
			_, _ = p.db.DB().Exec(`
				UPDATE ingest_jobs SET
					status = 'queued',
					error = '', error_code = '', error_message = '',
					runner_id = '', heartbeat_at = '',
					updated_at = datetime('now')
				WHERE id = ? AND status = 'running'`, jobID)
			log.Printf("ingest processor: recovered stale running job %s with residual worktree", jobID)
		}

		// Remove the worktree and branch (orphaned or recovered)
		if err := repo.RemoveWorktree(jobID); err != nil {
			log.Printf("ingest processor: cleanup worktree %s: %v", jobID, err)
		} else {
			log.Printf("ingest processor: cleaned up residual worktree for job %s", jobID)
		}
	}
}

func (p *JobProcessor) startHeartbeat(jobID string) func() {
	done := make(chan struct{})
	var once sync.Once
	stop := func() { once.Do(func() { close(done) }) }

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-p.stop:
				return
			case <-ticker.C:
				if err := p.db.TouchIngestJobHeartbeat(jobID, p.runnerID); err != nil {
					log.Printf("ingest processor: heartbeat %s: %v", jobID, err)
				}
			}
		}
	}()
	return stop
}

// claimNextJob atomically transitions the next queued job to "running".
func (p *JobProcessor) claimNextJob() (*sqlite.IngestJob, error) {
	job, err := p.db.ClaimNextIngestJob(p.runnerID)
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, nil
	}
	activity.LogIngestJob(p.db, job, "running", "processor")
	return job, nil
}

func (p *JobProcessor) failJob(id, errorCode, message, missingDep, remediation string) error {
	p.db.ClearIngestJobLease(id)
	err := p.db.UpdateIngestJobFailure(id, errorCode, message, missingDep, remediation)
	if failed, _ := p.db.GetIngestJob(id); failed != nil {
		activity.LogIngestJob(p.db, failed, "failed", "processor")
		p.logSessionArchiveOutcome(failed, "archive_failed", "failure")
		if failed.InputType == "rollback" {
			sha := failed.SourceRef
			activity.Record(p.db, activity.Entry{
				Level:        "error",
				Category:     "vcs",
				Action:       "rollback_failed",
				Message:      fmt.Sprintf("回滚失败：%s", sha),
				ResourceType: "commit",
				ResourceID:   sha,
				Status:       "failure",
				Source:       "processor",
				Details: map[string]interface{}{
					"commit_sha": sha,
					"job_id":     failed.ID,
					"error":      failed.ErrorMessage,
				},
			})
		}
	}
	return err
}

func (p *JobProcessor) logSessionArchiveOutcome(job *sqlite.IngestJob, action, status string) {
	if job == nil || job.InputType != string(InputKindSessionArchive) {
		return
	}
	if !strings.HasPrefix(job.SourceRef, "session:") {
		return
	}
	sessionID := strings.TrimPrefix(job.SourceRef, "session:")
	msg := fmt.Sprintf("会话归档%s", action)
	if action == "archive_succeeded" {
		msg = fmt.Sprintf("会话 %s 归档成功", sessionID)
	} else if action == "archive_failed" {
		msg = fmt.Sprintf("会话 %s 归档失败", sessionID)
	}
	activity.LogSession(p.db, action, sessionID, msg, status, "processor", map[string]interface{}{
		"job_id": job.ID,
		"error":  job.ErrorMessage,
	})
}

// ClaimNextQueuedJob is a convenience for tests to claim and return a job.
func (p *JobProcessor) ClaimNextQueuedJob(ctx context.Context) (*sqlite.IngestJob, error) {
	return p.claimNextJob()
}

// RunPipelineForJob runs the pipeline for an already-claimed job (for test use).
func (p *JobProcessor) RunPipelineForJob(ctx context.Context, job *sqlite.IngestJob) error {
	if _, err := os.Stat(filepath.Join(p.workspace, job.SourcePath)); err != nil {
		_ = p.failJob(job.ID, "source_read_failed",
			fmt.Sprintf("failed to read source file: %v", err),
			"", "ensure the source file exists on disk and is readable")
		return err
	}

	normalized, err := NormalizeJobSource(p.workspace, job.InputType, job.SourcePath, job.SourceRef)
	if err != nil {
		_ = p.failJob(job.ID, "normalize_failed", err.Error(), "", "")
		return err
	}

	if err := p.preparePipelineForJob(job); err != nil {
		return err
	}

	files, err := p.pipeline.IngestNormalized(ctx, normalized)
	if err != nil {
		errCode := classifyPipelineError(err)
		_ = p.failJob(job.ID, errCode, err.Error(), "", remediationForCode(errCode))
		return err
	}

	// Git commit (if version control is enabled)
	if repo := p.gitRepoIfEnabled(); repo != nil {
		commitMsg := vcs.BuildCommitMessage(
			filepath.Base(normalized.CanonicalPath),
			job.ID,
			job.InputType,
			string(normalized.Content),
		)
		sha, commitErr := repo.AddCommit(commitMsg)
		if commitErr != nil {
			_ = p.failJob(job.ID, "commit_failed",
				fmt.Sprintf("git commit failed: %v", commitErr), "", "")
			return commitErr
		}
		if sha != "" {
			_ = p.db.SetVCLastCommit(sha)
		}
		vcs.TryAutoPush(repo, p.db)
	}

	p.indexGeneratedWikiFiles(files, job.ID)

	summary := fmt.Sprintf("generated %d wiki page(s)", len(files))
	_, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = ?, updated_at = datetime('now')
		WHERE id = ?`, summary, job.ID)
	return updateErr
}

func (p *JobProcessor) indexGeneratedWikiFiles(files []string, jobID string) {
	if p.indexer == nil {
		return
	}
	for _, rel := range files {
		if err := p.indexer.IndexFile(rel); err != nil {
			log.Printf("processor: index %s after job %s: %v", rel, jobID, err)
			activity.RecordIndexFailed(p.db, rel, err)
			rec := NewSQLiteJobRecorder(p.db, jobID)
			rec.Record("index", "error", err.Error(), map[string]any{"path": rel})
		}
	}
}

// classifyPipelineError maps a pipeline error to a structured error code.
func classifyPipelineError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "unsupported protocol scheme") ||
		strings.Contains(msg, "base URL is not configured") ||
		strings.Contains(msg, "provider base URL"):
		return "llm_config_invalid"
	case strings.Contains(msg, "API key") || strings.Contains(msg, "unauthorized") || strings.Contains(msg, "401"):
		return "llm_auth_failed"
	case strings.Contains(msg, "quota") || strings.Contains(msg, "429") || strings.Contains(msg, "rate limit"):
		return "llm_rate_limited"
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline exceeded"):
		return "llm_timeout"
	case strings.Contains(msg, "unsupported format") || strings.Contains(msg, "unsupported file"):
		return "unsupported_format"
	case strings.Contains(msg, "analysis:") || strings.Contains(msg, "analyze"):
		return "analysis_failed"
	case strings.Contains(msg, "generation:") || strings.Contains(msg, "generate"):
		return "generation_failed"
	case errors.Is(err, errNoWikiFilesWritten) || strings.Contains(msg, "no wiki files written"):
		return "no_wiki_files_written"
	default:
		return "pipeline_error"
	}
}

func remediationForCode(code string) string {
	switch code {
	case "llm_config_invalid":
		return "configure Provider and base URL in Settings (Provider instances)"
	case "llm_auth_failed":
		return "check your API key in Settings"
	case "llm_rate_limited":
		return "wait a moment and retry, or reduce batch size"
	case "llm_timeout":
		return "the LLM request timed out; try again or use a smaller input"
	case "unsupported_format":
		return "convert the file to a supported format before uploading"
	case "analysis_failed", "generation_failed":
		return "the LLM pipeline encountered an error; check the job error message and server logs"
	case "no_wiki_files_written":
		return "the model produced FILE blocks but none were written; replan or check job logs for invalid paths"
	default:
		return ""
	}
}

func (p *JobProcessor) preparePipelineForJob(job *sqlite.IngestJob) error {
	client, err := p.resolveLLMClientForJob(job)
	if err != nil {
		_ = p.failJob(job.ID, "llm_config_invalid", err.Error(), "", remediationForCode("llm_config_invalid"))
		return err
	}
	p.pipeline.SetLLMClient(client)
	p.attachMCPRouter()

	// Resolve doc_language setting for generation prompts.
	// NOTE: Language is resolved at execution time from the current app_config.
	// If the user changes doc_language while a job is queued, the new value
	// will be used. Future improvement: snapshot doc_language into job metadata
	// at job creation time to ensure consistency.
	docLang := resolveDocLang(p.db)
	p.pipeline.SetDocLanguage(docLang)
	p.pipeline.SetRulesSupplement(ResolveRulesSupplement(p.db))

	return nil
}

// RecordRulesSnapshot writes rules_hash at job enqueue time.
func RecordRulesSnapshot(db *sqlite.DB, jobID, workspace string) {
	if db == nil || jobID == "" {
		return
	}
	hash := ComputeRulesHash(workspace, ResolveRulesSupplement(db))
	maxN := sqlite.DefaultJobEventsMaxCount
	if v, err := db.GetConfig("ingest_job_events_max_count"); err == nil {
		if n, err := sqlite.ParseJobEventsMaxCount(v); err == nil {
			maxN = n
		}
	}
	_ = db.InsertIngestJobEvent(jobID, "system", "queued", "rules snapshot", map[string]any{
		"rules_hash": hash,
	}, maxN)
}

// checkRulesDrift logs when execution-time rules differ from enqueue snapshot.
func (p *JobProcessor) checkRulesDrift(jobID string) {
	if p.pipeline.recorder == nil {
		return
	}
	current := ComputeRulesHash(p.workspace, ResolveRulesSupplement(p.db))
	snapshot := queuedRulesHash(p.db, jobID)
	if snapshot != "" && snapshot != current {
		p.pipeline.recorder.Record("system", "info", "rules_drift: workspace rules changed since job was queued", map[string]any{
			"rules_hash_snapshot": snapshot,
			"rules_hash_current":  current,
		})
	}
}

func queuedRulesHash(db *sqlite.DB, jobID string) string {
	events, err := db.ListIngestJobEvents(jobID, 50)
	if err != nil {
		return ""
	}
	for _, ev := range events {
		if ev.Step != "system" || ev.Phase != "queued" || ev.Payload == "" {
			continue
		}
		var payload struct {
			RulesHash string `json:"rules_hash"`
		}
		if json.Unmarshal([]byte(ev.Payload), &payload) == nil && payload.RulesHash != "" {
			return payload.RulesHash
		}
	}
	return ""
}

// resolveDocLang reads the doc_language setting from the database, defaulting to "zh".
func resolveDocLang(db interface {
	GetConfig(string) (string, error)
}) string {
	val, err := db.GetConfig("doc_language")
	if err != nil || (val != "zh" && val != "en") {
		return "zh"
	}
	return val
}

func (p *JobProcessor) attachMCPRouter() {
	raw, _ := p.db.GetConfig("mcp_servers_json")
	reg, err := mcp.NewRegistry(raw)
	if err != nil {
		p.pipeline.SetMCPRouter(nil)
		return
	}
	router := mcp.NewRouter(reg, &mcpRecorderAdapter{jobRec: p.pipeline.Recorder(), db: p.db})
	p.pipeline.SetMCPRouter(router)
}

func (p *JobProcessor) resolveLLMClientForJob(job *sqlite.IngestJob) (*llm.Client, error) {
	instanceID := ""
	model := ""

	if job.InputType == string(InputKindSessionArchive) && strings.HasPrefix(job.SourceRef, "session:") {
		sessionID := strings.TrimPrefix(job.SourceRef, "session:")
		session, err := p.db.GetIngestSession(sessionID)
		if err != nil {
			return nil, fmt.Errorf("load ingest session: %w", err)
		}
		if session != nil {
			instanceID = session.LLMInstanceID
			model = session.LLMModel
		}
	}

	if instanceID == "" {
		instanceID, _ = p.db.GetConfig("job_instance_id")
	}
	if model == "" {
		model, _ = p.db.GetConfig("job_model")
	}

	if instanceID == "" {
		instanceID, _ = p.db.GetConfig("last_instance_id")
	}
	if model == "" {
		model, _ = p.db.GetConfig("last_model")
	}

	if instanceID != "" && model != "" {
		return llm.ClientFromInstance(p.db, instanceID, model)
	}

	return llm.ClientFromWorkspace(p.workspace)
}
