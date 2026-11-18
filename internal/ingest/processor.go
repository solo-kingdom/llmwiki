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
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// JobProcessor polls the database for queued ingest jobs and runs them
// through the two-step LLM pipeline (analysis → generation).
//
// When parallel execution is enabled (VCS + git worktree), jobs run concurrently
// in isolated worktrees and merge back serially. Otherwise, jobs run serially.
type JobProcessor struct {
	db        store.Store
	workspace string
	pipeline  *Pipeline
	stop      chan struct{}
	runnerID  string
	workers   sync.WaitGroup
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
func NewJobProcessor(db store.Store, workspace string) *JobProcessor {
	return &JobProcessor{
		db:        db,
		workspace: workspace,
		pipeline:  NewPipelineWithDB(workspace, db, nil),
		stop:      make(chan struct{}),
		runnerID:  newRunnerID(),
	}
}

// Start begins the background processing loop. It polls every pollInterval.
// When parallel execution is enabled (VCS + git), launches a worker pool and merge queue.
// Otherwise falls back to serial single-goroutine processing.
func (p *JobProcessor) Start(pollInterval time.Duration) {
	if pollInterval <= 0 {
		pollInterval = 3 * time.Second
	}
	p.recoverStaleJobs()
	p.startSerial(pollInterval)
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

	normalized, err := NormalizeJobSource(p.workspace, job.InputType, job.SourcePath, job.SourceRef)
	if err != nil {
		return p.failJob(job.ID, "normalize_failed",
			fmt.Sprintf("normalization failed: %v", err), "", "")
	}

	if err := p.preparePipelineForJob(job); err != nil {
		return err
	}
	p.pipeline.SetChangeSetMeta("ingest", job.ID, "", filepath.Base(normalized.CanonicalPath), string(normalized.Content))
	defer p.pipeline.SetMCPRouter(nil)
	p.checkRulesDrift(job.ID)

	// Run through the two-step LLM pipeline
	files, err := p.pipeline.IngestNormalized(ctx, normalized)
	if err != nil {
		errCode := classifyPipelineError(err)
		return p.failJob(job.ID, errCode, err.Error(), "", remediationForCode(errCode))
	}

	p.finalizeWikiApply(job.ID, job.SourcePath, "", ApplyWikiResult{Written: files})
	// Mark job succeeded
	p.markJobSucceeded(job.ID, files)

	return nil
}

// markJobSucceeded marks a job as succeeded with a result summary.
func (p *JobProcessor) markJobSucceeded(jobID string, files []string) {
	summary := fmt.Sprintf("generated %d wiki page(s)", len(files))
	if err := p.db.MarkIngestJobSucceeded(jobID, summary); err != nil {
		log.Printf("processor: failed to mark job %s succeeded: %v", jobID, err)
	}
	if updated, _ := p.db.GetIngestJob(jobID); updated != nil {
		activity.LogIngestJob(p.db, updated, "succeeded", "processor")
		p.logSessionArchiveOutcome(updated, "archive_succeeded", "success")
	}
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
			"threshold_seconds": store.StaleHeartbeatSeconds,
		})
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
func (p *JobProcessor) claimNextJob() (*store.IngestJob, error) {
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

func (p *JobProcessor) logSessionArchiveOutcome(job *store.IngestJob, action, status string) {
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
func (p *JobProcessor) ClaimNextQueuedJob(ctx context.Context) (*store.IngestJob, error) {
	return p.claimNextJob()
}

// RunPipelineForJob runs the pipeline for an already-claimed job (for test use).
func (p *JobProcessor) RunPipelineForJob(ctx context.Context, job *store.IngestJob) error {
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
	p.pipeline.SetChangeSetMeta("ingest", job.ID, "", filepath.Base(normalized.CanonicalPath), string(normalized.Content))

	files, err := p.pipeline.IngestNormalized(ctx, normalized)
	if err != nil {
		errCode := classifyPipelineError(err)
		_ = p.failJob(job.ID, errCode, err.Error(), "", remediationForCode(errCode))
		return err
	}

	p.markJobSucceeded(job.ID, files)
	return nil
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

func (p *JobProcessor) preparePipelineForJob(job *store.IngestJob) error {
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
func RecordRulesSnapshot(db store.Store, jobID, workspace string) {
	if db == nil || jobID == "" {
		return
	}
	hash := ComputeRulesHash(workspace, ResolveRulesSupplement(db))
	maxN := store.DefaultJobEventsMaxCount
	if v, err := db.GetConfig("ingest_job_events_max_count"); err == nil {
		if n, err := store.ParseJobEventsMaxCount(v); err == nil {
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

func queuedRulesHash(db store.Store, jobID string) string {
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

func (p *JobProcessor) resolveLLMClientForJob(job *store.IngestJob) (*llm.Client, error) {
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
