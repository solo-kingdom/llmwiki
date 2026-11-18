package ingest

import (
	"context"
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// processRollbackJob undoes a change set deterministically using stored revisions.
func (p *JobProcessor) processRollbackJob(ctx context.Context, job *store.IngestJob) error {
	changeSetID := job.SourceRef
	if changeSetID == "" {
		return p.failJob(job.ID, "rollback_context_missing",
			"no change set specified for rollback", "", "")
	}
	target, err := p.db.GetChangeSet(changeSetID)
	if err != nil {
		return p.failJob(job.ID, "rollback_context_missing",
			fmt.Sprintf("failed to load change set %s: %v", changeSetID, err), "", "")
	}
	if target == nil {
		return p.failJob(job.ID, "rollback_context_missing",
			fmt.Sprintf("change set %s not found", changeSetID), "", "")
	}

	rb, err := p.db.UndoChangeSet(changeSetID, "rollback")
	if err != nil {
		return p.failJob(job.ID, "rollback_failed",
			fmt.Sprintf("rollback failed: %v", err), "", "")
	}

	summary := fmt.Sprintf("rolled back change set %s (%d page(s))", changeSetID, rb.PageCount)
	if err := p.db.MarkIngestJobSucceeded(job.ID, summary); err != nil {
		return err
	}
	if updated, _ := p.db.GetIngestJob(job.ID); updated != nil {
		activity.LogIngestJob(p.db, updated, "succeeded", "processor")
	}
	activity.Record(p.db, activity.Entry{
		Level:        "info",
		Category:     "history",
		Action:       "rollback_succeeded",
		Message:      fmt.Sprintf("回滚成功：%s", changeSetID),
		ResourceType: "change_set",
		ResourceID:   changeSetID,
		Status:       "success",
		Source:       "processor",
		Details: map[string]interface{}{
			"change_set_id":   changeSetID,
			"rollback_set_id": rb.ID,
			"job_id":          job.ID,
			"pages":           rb.PageCount,
		},
	})
	return nil
}
