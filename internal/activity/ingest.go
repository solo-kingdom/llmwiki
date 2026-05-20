package activity

import (
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// LogIngestJob records an ingest job lifecycle event.
func LogIngestJob(db *sqlite.DB, job *sqlite.IngestJob, action, source string) {
	if db == nil || job == nil {
		return
	}
	level := "info"
	status := job.Status
	if status == "failed" {
		level = "error"
	}
	msg := fmt.Sprintf("摄入任务 %s：%s", job.ID, action)
	if job.SourcePath != "" {
		msg = fmt.Sprintf("摄入任务 %s（%s）：%s", job.ID, job.SourcePath, action)
	}
	details := map[string]interface{}{
		"job_id":      job.ID,
		"source_path": job.SourcePath,
		"status":      status,
		"input_type":  job.InputType,
	}
	if job.ErrorMessage != "" {
		details["error"] = job.ErrorMessage
	}
	if job.ErrorCode != "" {
		details["error_code"] = job.ErrorCode
	}
	Record(db, Entry{
		Level:        level,
		Category:     "ingest",
		Action:       action,
		Message:      msg,
		ResourceType: "ingest_job",
		ResourceID:   job.ID,
		Status:       status,
		Source:       source,
		Details:      details,
	})
}
