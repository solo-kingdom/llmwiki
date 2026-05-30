package ingest

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"unicode/utf8"

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
	p.checkRulesDrift(job.ID)

	normalized, err := NormalizeJobSource(p.workspace, string(InputKindSessionArchive), job.SourcePath, job.SourceRef)
	if err != nil {
		return p.failReviewPlanFailed(reviewID, job.ID, "normalize_failed", err)
	}

	feedback := p.collectReviewFeedback(reviewID)
	if review.DeepOrganize {
		if simSummary := p.collectDeepOrganizeContext(); simSummary != "" {
			feedback = feedback + "\n\n" + simSummary
		}
	}
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
	p.checkRulesDrift(job.ID)

	plan, err := p.db.GetIngestReviewPlan(reviewID, review.ApprovedPlanVersion)
	if err != nil || plan == nil {
		return p.failReviewApplyFailed(reviewID, job.ID, "pipeline_error",
			fmt.Errorf("approved plan not found"))
	}

	normalized, err := NormalizeJobSource(p.workspace, string(InputKindSessionArchive), job.SourcePath, job.SourceRef)
	if err != nil {
		return p.failReviewApplyFailed(reviewID, job.ID, "normalize_failed", err)
	}

	repo := p.gitRepoIfEnabled()
	var applyResult ApplyWikiResult
	var mergeSHA string
	cleanupWorktree := repo != nil
	if repo != nil {
		defer func() {
			if cleanupWorktree {
				if err := repo.RemoveWorktree(job.ID); err != nil {
					log.Printf("review apply: cleanup worktree for job %s: %v", job.ID, err)
				}
			}
		}()

		worktreeDir, wtErr := repo.CreateWorktree(job.ID)
		if wtErr != nil {
			return p.failReviewApplyFailed(reviewID, job.ID, "worktree_failed", wtErr)
		}
		_ = worktreeDir

		prevTarget := p.pipeline.targetDir
		p.pipeline.SetTargetDir(worktreeDir)
		defer p.pipeline.SetTargetDir(prevTarget)

		applyResult, err = p.pipeline.ApplyFromPlan(ctx, normalized, plan.PlanJSON)
		if err != nil {
			code := classifyPipelineError(err)
			return p.failReviewApplyFailed(reviewID, job.ID, code, err)
		}
		if len(applyResult.Written) == 0 && len(applyResult.Deleted) == 0 {
			return p.failReviewApplyFailed(reviewID, job.ID, "no_wiki_files_written", errNoWikiFilesWritten)
		}

		commitMsg := vcs.BuildCommitMessage(
			filepath.Base(normalized.CanonicalPath),
			job.ID,
			string(InputKindReviewApply),
			string(normalized.Content),
		)
		if _, commitErr := repo.CommitInWorktree(worktreeDir, commitMsg); commitErr != nil {
			return p.failReviewApplyFailed(reviewID, job.ID, "commit_failed", commitErr)
		}

		llmClient, _ := p.resolveLLMClientForReview(review)
		mergeSHA, err = p.mergeWorktreeJobBranch(ctx, repo, job.ID, applyResult.Written, llmClient, nil)
		if err != nil {
			code := "merge_failed"
			if strings.Contains(err.Error(), "conflict resolution") {
				code = "merge_conflict"
			}
			return p.failReviewApplyFailed(reviewID, job.ID, code, err)
		}

		cleanupWorktree = false
		if err := repo.RemoveWorktree(job.ID); err != nil {
			log.Printf("review apply: cleanup worktree for job %s: %v", job.ID, err)
		}
	} else {
		applyResult, err = p.pipeline.ApplyFromPlan(ctx, normalized, plan.PlanJSON)
		if err != nil {
			code := classifyPipelineError(err)
			return p.failReviewApplyFailed(reviewID, job.ID, code, err)
		}
		if len(applyResult.Written) == 0 && len(applyResult.Deleted) == 0 {
			return p.failReviewApplyFailed(reviewID, job.ID, "no_wiki_files_written", errNoWikiFilesWritten)
		}
	}

	p.finalizeWikiApply(job.ID, job.SourcePath, plan.PlanJSON, applyResult)

	if mergeSHA != "" {
		_ = p.db.SetIngestReviewMergeCommitSHA(reviewID, mergeSHA)
	}
	_ = p.db.SetIngestReviewFinalJob(reviewID, job.ID)

	summary := fmt.Sprintf("applied %d wiki page(s) from approved plan v%d", len(applyResult.Written), review.ApprovedPlanVersion)
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
	p.pipeline.SetRulesSupplement(ResolveRulesSupplement(p.db))
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

func (p *JobProcessor) collectDeepOrganizeContext() string {
	if p.db == nil {
		return ""
	}
	docs, err := p.db.ListDocuments()
	if err != nil {
		return ""
	}
	var wikiDocs []sqlite.Document
	for _, d := range docs {
		if d.SourceKind == "wiki" {
			wikiDocs = append(wikiDocs, d)
		}
	}
	if len(wikiDocs) == 0 {
		return ""
	}

	var pairs []string
	seen := make(map[string]bool)
	for _, doc := range wikiDocs {
		query := doc.Content
		if utf8.RuneCountInString(query) > 500 {
			query = string([]rune(query)[:500])
		}
		if strings.TrimSpace(query) == "" {
			continue
		}
		results, err := p.db.SearchChunks(query, 5, "wiki")
		if err != nil {
			continue
		}
		for _, r := range results {
			if r.Path == doc.RelativePath || r.Score < 0.3 {
				continue
			}
			a, b := doc.RelativePath, r.Path
			if a > b {
				a, b = b, a
			}
			key := a + "|" + b
			if seen[key] {
				continue
			}
			seen[key] = true
			pairs = append(pairs, fmt.Sprintf("- %s ⟷ %s (重叠度: %.2f)", a, b, r.Score))
		}
	}

	if len(pairs) == 0 {
		return ""
	}

	return fmt.Sprintf("## 深度整理：检测到 %d 对内容相似页面\n\n%s\n\n请在计划中考虑合并这些相似页面，使用 merge action 并填写 source_paths 和 to_path。", len(pairs), strings.Join(pairs, "\n"))
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
func EnqueueReviewPlanJob(db *sqlite.DB, workspace string, review *sqlite.IngestReview) (*sqlite.IngestJob, error) {
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
	RecordRulesSnapshot(db, job.ID, workspace)
	activity.LogIngestJob(db, job, "queued", "api")
	return job, nil
}

// EnqueueReviewApplyJob queues apply execution after approval.
func EnqueueReviewApplyJob(db *sqlite.DB, workspace string, review *sqlite.IngestReview) (*sqlite.IngestJob, error) {
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
	RecordRulesSnapshot(db, job.ID, workspace)
	activity.LogIngestJob(db, job, "queued", "api")
	return job, nil
}
