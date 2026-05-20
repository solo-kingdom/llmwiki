package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
)

type IngestJob struct {
	ID                string `json:"id"`
	ParentJobID       string `json:"parent_job_id"`
	InputType         string `json:"input_type"`
	SourcePath        string `json:"source_path"`
	SourceRef         string `json:"source_ref"`
	Status            string `json:"status"`
	Retries           int    `json:"retries"`
	MaxRetries        int    `json:"max_retries"`
	Error             string `json:"error"`
	ErrorCode         string `json:"error_code"`
	ErrorMessage      string `json:"error_message"`
	MissingDependency string `json:"missing_dependency"`
	Remediation       string `json:"remediation"`
	ResultSummary     string `json:"result_summary"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

var validJobStatus = map[string]bool{
	"queued":    true,
	"running":   true,
	"succeeded": true,
	"failed":    true,
	"cancelled": true,
}

func normalizeJobStatus(status string) string {
	s := strings.ToLower(strings.TrimSpace(status))
	switch s {
	case "pending":
		return "queued"
	case "processing":
		return "running"
	case "done":
		return "succeeded"
	default:
		return s
	}
}

func validateJobStatus(status string) error {
	s := normalizeJobStatus(status)
	if !validJobStatus[s] {
		return fmt.Errorf("invalid ingest job status: %s", status)
	}
	return nil
}

func scanIngestJob(scanner interface{ Scan(...interface{}) error }, job *IngestJob) error {
	return scanner.Scan(
		&job.ID,
		&job.ParentJobID,
		&job.InputType,
		&job.SourcePath,
		&job.SourceRef,
		&job.Status,
		&job.Retries,
		&job.MaxRetries,
		&job.Error,
		&job.ErrorCode,
		&job.ErrorMessage,
		&job.MissingDependency,
		&job.Remediation,
		&job.ResultSummary,
		&job.CreatedAt,
		&job.UpdatedAt,
	)
}

func (d *DB) CreateIngestJob(job *IngestJob) error {
	if job == nil {
		return fmt.Errorf("nil ingest job")
	}
	if job.SourcePath == "" {
		return fmt.Errorf("source_path is required")
	}
	if job.InputType == "" {
		job.InputType = "file"
	}
	if job.Status == "" {
		job.Status = "queued"
	}
	job.Status = normalizeJobStatus(job.Status)
	if err := validateJobStatus(job.Status); err != nil {
		return err
	}
	if job.MaxRetries <= 0 {
		job.MaxRetries = 3
	}

	var parent interface{}
	if strings.TrimSpace(job.ParentJobID) != "" {
		parent = strings.TrimSpace(job.ParentJobID)
	}

	result, err := d.db.Exec(`
		INSERT INTO ingest_jobs (
			parent_job_id, input_type, source_path, source_ref, status,
			retries, max_retries, error, error_code, error_message,
			missing_dependency, remediation, result_summary, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
		parent,
		strings.TrimSpace(job.InputType),
		job.SourcePath,
		strings.TrimSpace(job.SourceRef),
		job.Status,
		job.Retries,
		job.MaxRetries,
		job.Error,
		job.ErrorCode,
		job.ErrorMessage,
		job.MissingDependency,
		job.Remediation,
		job.ResultSummary,
	)
	if err != nil {
		return fmt.Errorf("create ingest job: %w", err)
	}

	if id, err := result.LastInsertId(); err == nil && id > 0 {
		_ = id // modernc sqlite rowid not used here
	}

	created, err := d.db.Query(`
		SELECT
			COALESCE(id, ''), COALESCE(parent_job_id, ''), COALESCE(input_type, ''),
			COALESCE(source_path, ''), COALESCE(source_ref, ''), COALESCE(status, ''),
			COALESCE(retries, 0), COALESCE(max_retries, 3), COALESCE(error, ''),
			COALESCE(error_code, ''), COALESCE(error_message, ''),
			COALESCE(missing_dependency, ''), COALESCE(remediation, ''),
			COALESCE(result_summary, ''), COALESCE(created_at, ''), COALESCE(updated_at, '')
		FROM ingest_jobs
		WHERE rowid = last_insert_rowid()`)
	if err != nil {
		return fmt.Errorf("fetch created ingest job: %w", err)
	}
	defer created.Close()
	if created.Next() {
		if err := scanIngestJob(created, job); err != nil {
			return fmt.Errorf("scan created ingest job: %w", err)
		}
	}
	return created.Err()
}

func (d *DB) GetIngestJob(id string) (*IngestJob, error) {
	job := &IngestJob{}
	err := scanIngestJob(d.db.QueryRow(`
		SELECT
			COALESCE(id, ''), COALESCE(parent_job_id, ''), COALESCE(input_type, ''),
			COALESCE(source_path, ''), COALESCE(source_ref, ''), COALESCE(status, ''),
			COALESCE(retries, 0), COALESCE(max_retries, 3), COALESCE(error, ''),
			COALESCE(error_code, ''), COALESCE(error_message, ''),
			COALESCE(missing_dependency, ''), COALESCE(remediation, ''),
			COALESCE(result_summary, ''), COALESCE(created_at, ''), COALESCE(updated_at, '')
		FROM ingest_jobs WHERE id = ?`, id), job)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get ingest job: %w", err)
	}
	job.Status = normalizeJobStatus(job.Status)
	return job, nil
}

func (d *DB) ListIngestJobs(limit int) ([]IngestJob, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := d.db.Query(`
		SELECT
			COALESCE(id, ''), COALESCE(parent_job_id, ''), COALESCE(input_type, ''),
			COALESCE(source_path, ''), COALESCE(source_ref, ''), COALESCE(status, ''),
			COALESCE(retries, 0), COALESCE(max_retries, 3), COALESCE(error, ''),
			COALESCE(error_code, ''), COALESCE(error_message, ''),
			COALESCE(missing_dependency, ''), COALESCE(remediation, ''),
			COALESCE(result_summary, ''), COALESCE(created_at, ''), COALESCE(updated_at, '')
		FROM ingest_jobs
		ORDER BY datetime(created_at) DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list ingest jobs: %w", err)
	}
	defer rows.Close()

	jobs := make([]IngestJob, 0, limit)
	for rows.Next() {
		var job IngestJob
		if err := scanIngestJob(rows, &job); err != nil {
			return nil, fmt.Errorf("scan ingest job: %w", err)
		}
		job.Status = normalizeJobStatus(job.Status)
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (d *DB) UpdateIngestJobStatus(id, status string) error {
	status = normalizeJobStatus(status)
	if err := validateJobStatus(status); err != nil {
		return err
	}
	_, err := d.db.Exec(`
		UPDATE ingest_jobs
		SET status = ?, updated_at = datetime('now')
		WHERE id = ?`, status, id)
	if err != nil {
		return fmt.Errorf("update ingest job status: %w", err)
	}
	return nil
}

func (d *DB) UpdateIngestJobFailure(id, errorCode, message, missingDep, remediation string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_jobs
		SET
			status = 'failed',
			retries = retries + 1,
			error = ?,
			error_code = ?,
			error_message = ?,
			missing_dependency = ?,
			remediation = ?,
			updated_at = datetime('now')
		WHERE id = ?`,
		message,
		errorCode,
		message,
		missingDep,
		remediation,
		id,
	)
	if err != nil {
		return fmt.Errorf("update ingest job failure: %w", err)
	}
	return nil
}

// GetJobLineage returns the full retry chain for a job (parent → child).
// The returned slice is ordered from oldest ancestor to the given job.
func (d *DB) GetJobLineage(id string) ([]IngestJob, error) {
	// First, walk up to find the root ancestor
	var chain []IngestJob
	current := id
	visited := make(map[string]bool)
	for {
		if visited[current] {
			break // prevent cycles
		}
		visited[current] = true
		job, err := d.GetIngestJob(current)
		if err != nil {
			return nil, err
		}
		if job == nil {
			break
		}
		chain = append([]IngestJob{*job}, chain...)
		if job.ParentJobID == "" {
			break
		}
		current = job.ParentJobID
	}
	return chain, nil
}

func (d *DB) CancelIngestJob(id string) (bool, error) {
	result, err := d.db.Exec(`
		UPDATE ingest_jobs
		SET status = 'cancelled', updated_at = datetime('now')
		WHERE id = ? AND status IN ('queued', 'pending')`, id)
	if err != nil {
		return false, fmt.Errorf("cancel ingest job: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("cancel ingest job rows: %w", err)
	}
	return affected > 0, nil
}

func (d *DB) RetryIngestJob(id string) (*IngestJob, error) {
	original, err := d.GetIngestJob(id)
	if err != nil {
		return nil, err
	}
	if original == nil {
		return nil, nil
	}
	if original.Status != "failed" && original.Status != "cancelled" {
		return nil, fmt.Errorf("only failed and cancelled jobs can be retried")
	}

	retry := &IngestJob{
		ParentJobID: original.ID,
		InputType:   original.InputType,
		SourcePath:  original.SourcePath,
		SourceRef:   original.SourceRef,
		Status:      "queued",
		MaxRetries:  original.MaxRetries,
	}
	if retry.MaxRetries <= 0 {
		retry.MaxRetries = 3
	}
	if err := d.CreateIngestJob(retry); err != nil {
		return nil, err
	}
	return retry, nil
}
