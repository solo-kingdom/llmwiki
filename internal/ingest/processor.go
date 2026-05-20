package ingest

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

// JobProcessor polls the database for queued ingest jobs and runs them
// through the two-step LLM pipeline (analysis → generation).
type JobProcessor struct {
	db        *sqlite.DB
	workspace string
	pipeline  *Pipeline
	gitRepo   *vcs.GitRepo // nil if version control is not enabled
	indexer   *engine.WorkspaceFileIndexer
	stop      chan struct{}
}

// NewJobProcessor creates a new processor. It needs the main DB (not the
// legacy queue DB) so it can read/write the unified ingest_jobs table.
func NewJobProcessor(db *sqlite.DB, workspace string) *JobProcessor {
	return &JobProcessor{
		db:        db,
		workspace: workspace,
		pipeline:  NewPipeline(workspace, nil),
		stop:      make(chan struct{}),
	}
}

// SetGitRepo sets the git repo handle for version control.
// Pass nil to disable version control commits.
func (p *JobProcessor) SetGitRepo(repo *vcs.GitRepo) {
	p.gitRepo = repo
}

// SetFileIndexer sets the workspace file indexer for post-ingest search indexing.
func (p *JobProcessor) SetFileIndexer(indexer *engine.WorkspaceFileIndexer) {
	p.indexer = indexer
}

// Start begins the background processing loop. It polls every pollInterval.
func (p *JobProcessor) Start(pollInterval time.Duration) {
	if pollInterval <= 0 {
		pollInterval = 3 * time.Second
	}
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

// Stop signals the processor to stop.
func (p *JobProcessor) Stop() {
	close(p.stop)
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

	// Check if this is a rollback job
	if job.InputType == "rollback" {
		return p.processRollbackJob(ctx, job)
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

	// Run through the two-step LLM pipeline
	files, err := p.pipeline.IngestNormalized(ctx, normalized)
	if err != nil {
		errCode := classifyPipelineError(err)
		return p.failJob(job.ID, errCode, err.Error(), "", remediationForCode(errCode))
	}

	// Git commit (if version control is enabled)
	if p.gitRepo != nil {
		commitMsg := vcs.BuildCommitMessage(
			filepath.Base(normalized.CanonicalPath),
			job.ID,
			job.InputType,
			string(normalized.Content),
		)
		sha, err := p.gitRepo.AddCommit(commitMsg)
		if err != nil {
			return p.failJob(job.ID, "commit_failed",
				fmt.Sprintf("git commit failed: %v", err), "", "")
		}
		// Store last commit SHA
		if sha != "" {
			_ = p.db.SetVCLastCommit(sha)
		}
	}

	p.indexGeneratedWikiFiles(files, job.ID)

	// Mark job succeeded with result summary
	summary := fmt.Sprintf("generated %d wiki page(s)", len(files))
	if _, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = ?, updated_at = datetime('now')
		WHERE id = ?`, summary, job.ID); updateErr != nil {
		log.Printf("processor: failed to mark job %s succeeded: %v", job.ID, updateErr)
	}
	if updated, _ := p.db.GetIngestJob(job.ID); updated != nil {
		activity.LogIngestJob(p.db, updated, "succeeded", "processor")
		p.logSessionArchiveOutcome(updated, "archive_succeeded", "success")
	}

	return nil
}

// retryCommitOnly retries only the git commit for a job that previously failed at the commit stage.
func (p *JobProcessor) retryCommitOnly(job *sqlite.IngestJob) error {
	if p.gitRepo == nil {
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
	sha, err := p.gitRepo.AddCommit(commitMsg)
	if err != nil {
		return p.failJob(job.ID, "commit_failed",
			fmt.Sprintf("git commit retry failed: %v", err), "", "")
	}
	if sha != "" {
		_ = p.db.SetVCLastCommit(sha)
	}

	_, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = 'commit retry succeeded', updated_at = datetime('now')
		WHERE id = ?`, job.ID)
	return updateErr
}

// Ensure JobProcessor uses sql.DB through the sqlite.DB accessor.
var _ = (*sql.DB)(nil)

// claimNextJob atomically transitions the next queued job to "running".
func (p *JobProcessor) claimNextJob() (*sqlite.IngestJob, error) {
	rows, err := p.db.DB().Query(`
		SELECT
			COALESCE(id, ''), COALESCE(parent_job_id, ''), COALESCE(input_type, ''),
			COALESCE(source_path, ''), COALESCE(source_ref, ''), COALESCE(status, ''),
			COALESCE(retries, 0), COALESCE(max_retries, 3), COALESCE(error, ''),
			COALESCE(error_code, ''), COALESCE(error_message, ''),
			COALESCE(missing_dependency, ''), COALESCE(remediation, ''),
			COALESCE(result_summary, ''), COALESCE(created_at, ''), COALESCE(updated_at, '')
		FROM ingest_jobs
		WHERE status = 'queued'
		ORDER BY datetime(created_at) ASC
		LIMIT 1`)
	if err != nil {
		return nil, fmt.Errorf("query queued jobs: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, nil
	}

	var job sqlite.IngestJob
	if err := scanJobRow(rows, &job); err != nil {
		return nil, fmt.Errorf("scan queued job: %w", err)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Transition to running
	result, err := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'running', updated_at = datetime('now')
		WHERE id = ? AND status = 'queued'`, job.ID)
	if err != nil {
		return nil, fmt.Errorf("claim job %s: %w", job.ID, err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, nil // someone else claimed it
	}

	job.Status = "running"
	activity.LogIngestJob(p.db, &job, "running", "processor")
	return &job, nil
}

func (p *JobProcessor) failJob(id, errorCode, message, missingDep, remediation string) error {
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

// scanJobRow scans a row into an IngestJob using the standard column order.
func scanJobRow(scanner interface{ Scan(...interface{}) error }, job *sqlite.IngestJob) error {
	return scanner.Scan(
		&job.ID, &job.ParentJobID, &job.InputType,
		&job.SourcePath, &job.SourceRef, &job.Status,
		&job.Retries, &job.MaxRetries, &job.Error,
		&job.ErrorCode, &job.ErrorMessage,
		&job.MissingDependency, &job.Remediation,
		&job.ResultSummary, &job.CreatedAt, &job.UpdatedAt,
	)
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
	if p.gitRepo != nil {
		commitMsg := vcs.BuildCommitMessage(
			filepath.Base(normalized.CanonicalPath),
			job.ID,
			job.InputType,
			string(normalized.Content),
		)
		sha, commitErr := p.gitRepo.AddCommit(commitMsg)
		if commitErr != nil {
			_ = p.failJob(job.ID, "commit_failed",
				fmt.Sprintf("git commit failed: %v", commitErr), "", "")
			return commitErr
		}
		if sha != "" {
			_ = p.db.SetVCLastCommit(sha)
		}
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
	return nil
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
