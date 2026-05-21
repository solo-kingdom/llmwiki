package ingest

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

func (p *JobProcessor) processReviewPlanJob(ctx context.Context, job *sqlite.IngestJob) error {
	reviewID, ok := ParseReviewIDFromRef(job.SourceRef)
	if !ok {
		return p.failJob(job.ID, "pipeline_error", "invalid review source_ref", "", "")
	}
	review, err := p.db.GetIngestReview(reviewID)
	if err != nil || review == nil {
		return p.failJob(job.ID, "pipeline_error", "review not found", "", "")
	}

	if err := p.preparePipelineForReviewJob(job, review); err != nil {
		return err
	}
	defer p.pipeline.SetMCPRouter(nil)

	normalized, err := NormalizeJobSource(p.workspace, string(InputKindSessionArchive), job.SourcePath, job.SourceRef)
	if err != nil {
		return p.failReviewPlanFailed(reviewID, job.ID, "normalize_failed", err)
	}

	feedback := p.collectReviewFeedback(reviewID)
	plan, err := p.pipeline.PlanOnly(ctx, normalized, feedback)
	if err != nil {
		return p.failReviewPlanFailed(reviewID, job.ID, classifyPipelineError(err), err)
	}

	version, err := p.db.NextIngestReviewPlanVersion(reviewID)
	if err != nil {
		return p.failReviewPlanFailed(reviewID, job.ID, "pipeline_error", err)
	}
	rp := &sqlite.IngestReviewPlan{
		ReviewID:     reviewID,
		Version:      version,
		PlanMarkdown: plan.PlanMarkdown,
		PlanJSON:     plan.PlanJSON,
	}
	if err := p.db.CreateIngestReviewPlan(rp); err != nil {
		return p.failReviewPlanFailed(reviewID, job.ID, "pipeline_error", err)
	}
	_ = p.db.SetIngestReviewPlanVersion(reviewID, version)

	summaryMsg := &sqlite.IngestReviewMessage{
		ReviewID:    reviewID,
		Role:        "assistant",
		MessageType: "plan_summary",
		Content:     fmt.Sprintf("Plan v%d ready for review.", version),
	}
	_ = p.db.CreateIngestReviewMessage(summaryMsg)

	targetStatus := "ready_for_review"
	if review.Status == "revising" || review.Status == "failed" {
		if err := p.db.UpdateIngestReviewStatus(reviewID, targetStatus); err != nil {
			return p.failReviewPlanFailed(reviewID, job.ID, "pipeline_error", err)
		}
	} else if review.Status == "planning" {
		if err := p.db.UpdateIngestReviewStatus(reviewID, targetStatus); err != nil {
			return p.failReviewPlanFailed(reviewID, job.ID, "pipeline_error", err)
		}
	}
	p.logReviewEvent(reviewID, review.SessionID, "review_ready", "plan ready for review", "success")

	_, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = ?, runner_id = '', heartbeat_at = '',
		    updated_at = datetime('now')
		WHERE id = ?`, fmt.Sprintf("plan v%d generated", version), job.ID)
	return updateErr
}

func (p *JobProcessor) processReviewApplyJob(ctx context.Context, job *sqlite.IngestJob) error {
	reviewID, ok := ParseReviewIDFromRef(job.SourceRef)
	if !ok {
		return p.failJob(job.ID, "pipeline_error", "invalid review source_ref", "", "")
	}
	review, err := p.db.GetIngestReview(reviewID)
	if err != nil || review == nil {
		return p.failJob(job.ID, "pipeline_error", "review not found", "", "")
	}
	if review.ApprovedPlanVersion <= 0 {
		return p.failReviewApplyFailed(reviewID, job.ID, "pipeline_error",
			fmt.Errorf("no approved plan version"))
	}

	if err := p.db.UpdateIngestReviewStatus(reviewID, "applying"); err != nil {
		return p.failReviewApplyFailed(reviewID, job.ID, "pipeline_error", err)
	}
	p.logReviewEvent(reviewID, review.SessionID, "review_applying", "apply started", "pending")

	if err := p.preparePipelineForReviewJob(job, review); err != nil {
		return err
	}
	defer p.pipeline.SetMCPRouter(nil)

	plan, err := p.db.GetIngestReviewPlan(reviewID, review.ApprovedPlanVersion)
	if err != nil || plan == nil {
		return p.failReviewApplyFailed(reviewID, job.ID, "pipeline_error",
			fmt.Errorf("approved plan not found"))
	}

	normalized, err := NormalizeJobSource(p.workspace, string(InputKindSessionArchive), job.SourcePath, job.SourceRef)
	if err != nil {
		return p.failReviewApplyFailed(reviewID, job.ID, "normalize_failed", err)
	}

	files, err := p.pipeline.ApplyFromPlan(ctx, normalized, plan.PlanJSON)
	if err != nil {
		return p.failReviewApplyFailed(reviewID, job.ID, classifyPipelineError(err), err)
	}

	if repo := p.gitRepoIfEnabled(); repo != nil {
		commitMsg := vcs.BuildCommitMessage(
			filepath.Base(normalized.CanonicalPath),
			job.ID,
			string(InputKindReviewApply),
			string(normalized.Content),
		)
		sha, commitErr := repo.AddCommit(commitMsg)
		if commitErr != nil {
			return p.failReviewApplyFailed(reviewID, job.ID, "commit_failed", commitErr)
		}
		if sha != "" {
			_ = p.db.SetVCLastCommit(sha)
		}
	}

	p.indexGeneratedWikiFiles(files, job.ID)
	_ = p.db.SetIngestReviewFinalJob(reviewID, job.ID)

	summary := fmt.Sprintf("applied %d wiki page(s) from approved plan v%d", len(files), review.ApprovedPlanVersion)
	_, updateErr := p.db.DB().Exec(`
		UPDATE ingest_jobs
		SET status = 'succeeded', result_summary = ?, runner_id = '', heartbeat_at = '',
		    updated_at = datetime('now')
		WHERE id = ?`, summary, job.ID)
	if updateErr != nil {
		return updateErr
	}
	if err := p.db.UpdateIngestReviewStatus(reviewID, "succeeded"); err != nil {
		log.Printf("review %s: mark succeeded: %v", reviewID, err)
	}
	p.logReviewEvent(reviewID, review.SessionID, "review_succeeded", summary, "success")
	if review.SessionID != "" {
		activity.LogSession(p.db, "archive_succeeded", review.SessionID,
			fmt.Sprintf("会话 %s 归档审核执行成功", review.SessionID), "success", "processor",
			map[string]interface{}{"job_id": job.ID, "review_id": reviewID})
	}
	return nil
}

func (p *JobProcessor) preparePipelineForReviewJob(job *sqlite.IngestJob, review *sqlite.IngestReview) error {
	client, err := p.resolveLLMClientForReview(review)
	if err != nil {
		_ = p.failJob(job.ID, "llm_config_invalid", err.Error(), "", remediationForCode("llm_config_invalid"))
		return err
	}
	p.pipeline.SetLLMClient(client)
	p.attachMCPRouter()
	p.pipeline.SetDocLanguage(resolveDocLang(p.db))
	return nil
}

func (p *JobProcessor) resolveLLMClientForReview(review *sqlite.IngestReview) (*llm.Client, error) {
	if review != nil && review.SessionID != "" {
		session, err := p.db.GetIngestSession(review.SessionID)
		if err != nil {
			return nil, fmt.Errorf("load ingest session: %w", err)
		}
		if session != nil && session.LLMInstanceID != "" && session.LLMModel != "" {
			return llm.ClientFromInstance(p.db, session.LLMInstanceID, session.LLMModel)
		}
	}
	instanceID, _ := p.db.GetConfig("job_instance_id")
	model, _ := p.db.GetConfig("job_model")
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

func (p *JobProcessor) collectReviewFeedback(reviewID string) string {
	msgs, err := p.db.ListIngestReviewMessages(reviewID)
	if err != nil {
		return ""
	}
	var feedback []string
	for _, m := range msgs {
		if m.MessageType == "feedback" && m.Role == "user" && strings.TrimSpace(m.Content) != "" {
			feedback = append(feedback, m.Content)
		}
	}
	return FormatFeedbackForPlan(feedback)
}

func (p *JobProcessor) failReviewPlanFailed(reviewID, jobID, code string, err error) error {
	_ = p.db.UpdateIngestReviewStatus(reviewID, "failed")
	review, _ := p.db.GetIngestReview(reviewID)
	if review != nil {
		p.logReviewEvent(reviewID, review.SessionID, "review_plan_failed", err.Error(), "failure")
	}
	return p.failJob(jobID, code, err.Error(), "", remediationForCode(code))
}

func (p *JobProcessor) failReviewApplyFailed(reviewID, jobID, code string, err error) error {
	_ = p.db.UpdateIngestReviewStatus(reviewID, "failed")
	review, _ := p.db.GetIngestReview(reviewID)
	if review != nil {
		p.logReviewEvent(reviewID, review.SessionID, "review_apply_failed", err.Error(), "failure")
		if review.SessionID != "" {
			activity.LogSession(p.db, "archive_failed", review.SessionID,
				fmt.Sprintf("会话 %s 归档审核执行失败", review.SessionID), "failure", "processor",
				map[string]interface{}{"job_id": jobID, "review_id": reviewID, "error": err.Error()})
		}
	}
	return p.failJob(jobID, code, err.Error(), "", remediationForCode(code))
}

func (p *JobProcessor) logReviewEvent(reviewID, sessionID, action, message, status string) {
	details := map[string]interface{}{"review_id": reviewID}
	if sessionID != "" {
		details["session_id"] = sessionID
	}
	activity.Record(p.db, activity.Entry{
		Level:        "info",
		Category:     "ingest",
		Action:       action,
		Message:      message,
		ResourceType: "review",
		ResourceID:   reviewID,
		Status:       status,
		Source:       "processor",
		Details:      details,
	})
}

// EnqueueReviewPlanJob queues a background plan generation job for a review.
func EnqueueReviewPlanJob(db *sqlite.DB, review *sqlite.IngestReview) (*sqlite.IngestJob, error) {
	if review == nil {
		return nil, fmt.Errorf("nil review")
	}
	job := &sqlite.IngestJob{
		InputType:  string(InputKindReviewPlan),
		SourcePath: review.ArchiveSourcePath,
		SourceRef:  ReviewSourceRef(review.ID),
		Status:     "queued",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		return nil, err
	}
	activity.LogIngestJob(db, job, "queued", "api")
	return job, nil
}

// EnqueueReviewApplyJob queues apply execution after approval.
func EnqueueReviewApplyJob(db *sqlite.DB, review *sqlite.IngestReview) (*sqlite.IngestJob, error) {
	if review == nil {
		return nil, fmt.Errorf("nil review")
	}
	job := &sqlite.IngestJob{
		InputType:  string(InputKindReviewApply),
		SourcePath: review.ArchiveSourcePath,
		SourceRef:  ReviewSourceRef(review.ID),
		Status:     "queued",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		return nil, err
	}
	activity.LogIngestJob(db, job, "queued", "api")
	return job, nil
}
