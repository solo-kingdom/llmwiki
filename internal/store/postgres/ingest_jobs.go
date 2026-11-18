package postgres

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

const ingestJobSelectColumns = `
	COALESCE(id, ''), COALESCE(parent_job_id, ''), COALESCE(input_type, ''),
	COALESCE(source_path, ''), COALESCE(source_ref, ''), COALESCE(status, ''),
	COALESCE(retries, 0), COALESCE(max_retries, 3), COALESCE(error, ''),
	COALESCE(error_code, ''), COALESCE(error_message, ''),
	COALESCE(missing_dependency, ''), COALESCE(remediation, ''),
	COALESCE(result_summary, ''), COALESCE(runner_id, ''), COALESCE(heartbeat_at, ''),
	COALESCE(created_at, ''), COALESCE(updated_at, '')`

// ingestStaleCutoff is the heartbeat cutoff below which a running job is stale.
var ingestStaleCutoff = fmt.Sprintf(
	"to_char((now() AT TIME ZONE 'utc') - interval '%d seconds', 'YYYY-MM-DD HH24:MI:SS')",
	store.StaleHeartbeatSeconds)

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

func scanIngestJob(scanner interface{ Scan(...any) error }, job *store.IngestJob) error {
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
		&job.RunnerID,
		&job.HeartbeatAt,
		&job.CreatedAt,
		&job.UpdatedAt,
	)
}

// ingestConfigValue reads a config value straight from app_config so the job
// store does not depend on the config store implementation.
func (d *DB) ingestConfigValue(ctx context.Context, key string) string {
	var value string
	if err := d.pool.QueryRow(ctx,
		`SELECT COALESCE(value, '') FROM app_config WHERE key = $1`, key).Scan(&value); err != nil {
		return ""
	}
	return value
}

func ingestNullableID(id string) any {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	return id
}

func (d *DB) CreateIngestJob(job *store.IngestJob) error {
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

	ctx := context.Background()
	row := d.pool.QueryRow(ctx, `
		INSERT INTO ingest_jobs (
			id, parent_job_id, input_type, source_path, source_ref, status,
			retries, max_retries, error, error_code, error_message,
			missing_dependency, remediation, result_summary, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, `+nowText+`, `+nowText+`)
		RETURNING `+ingestJobSelectColumns,
		uuid.New().String(),
		ingestNullableID(job.ParentJobID),
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
	if err := scanIngestJob(row, job); err != nil {
		return fmt.Errorf("create ingest job: %w", err)
	}
	return nil
}

func (d *DB) GetIngestJobBySourceRef(sourceRef, inputType string) (*store.IngestJob, error) {
	sourceRef = strings.TrimSpace(sourceRef)
	inputType = strings.TrimSpace(inputType)
	if sourceRef == "" || inputType == "" {
		return nil, nil
	}
	job := &store.IngestJob{}
	err := scanIngestJob(d.pool.QueryRow(context.Background(), `
		SELECT `+ingestJobSelectColumns+`
		FROM ingest_jobs
		WHERE source_ref = $1 AND input_type = $2
		ORDER BY created_at DESC, id DESC
		LIMIT 1`, sourceRef, inputType), job)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("get ingest job by source ref: %w", err)
	}
	job.Status = normalizeJobStatus(job.Status)
	return job, nil
}

func (d *DB) GetIngestJob(id string) (*store.IngestJob, error) {
	job := &store.IngestJob{}
	err := scanIngestJob(d.pool.QueryRow(context.Background(), `
		SELECT `+ingestJobSelectColumns+`
		FROM ingest_jobs WHERE id = $1`, id), job)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("get ingest job: %w", err)
	}
	job.Status = normalizeJobStatus(job.Status)
	return job, nil
}

func (d *DB) ListIngestJobs(limit int) ([]store.IngestJob, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := d.pool.Query(context.Background(), `
		SELECT `+ingestJobSelectColumns+`
		FROM ingest_jobs
		ORDER BY created_at DESC, id DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list ingest jobs: %w", err)
	}
	defer rows.Close()

	jobs := make([]store.IngestJob, 0, limit)
	for rows.Next() {
		var job store.IngestJob
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
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs
		SET status = $1, updated_at = `+nowText+`
		WHERE id = $2`, status, id)
	if err != nil {
		return fmt.Errorf("update ingest job status: %w", err)
	}
	return nil
}

func (d *DB) UpdateIngestJobFailure(id, errorCode, message, missingDep, remediation string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs
		SET
			status = 'failed',
			retries = retries + 1,
			error = $1,
			error_code = $2,
			error_message = $3,
			missing_dependency = $4,
			remediation = $5,
			updated_at = `+nowText+`
		WHERE id = $6`,
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

// GetJobLineage returns the full retry chain for a job (root ancestor → given
// job), walking parent_job_id upwards with a depth guard against cycles.
func (d *DB) GetJobLineage(id string) ([]store.IngestJob, error) {
	rows, err := d.pool.Query(context.Background(), `
		WITH RECURSIVE lineage AS (
			SELECT j.*, 0 AS depth FROM ingest_jobs j WHERE j.id = $1
			UNION ALL
			SELECT j.*, l.depth + 1 FROM ingest_jobs j
			JOIN lineage l ON j.id = l.parent_job_id
			WHERE l.depth < 63
		)
		SELECT `+ingestJobSelectColumns+`
		FROM lineage
		ORDER BY depth DESC`, id)
	if err != nil {
		return nil, fmt.Errorf("get job lineage: %w", err)
	}
	defer rows.Close()

	chain := make([]store.IngestJob, 0, 4)
	for rows.Next() {
		var job store.IngestJob
		if err := scanIngestJob(rows, &job); err != nil {
			return nil, fmt.Errorf("scan job lineage: %w", err)
		}
		job.Status = normalizeJobStatus(job.Status)
		chain = append(chain, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(chain) == 0 {
		return nil, nil
	}
	return chain, nil
}

func (d *DB) CancelIngestJob(id string) (bool, error) {
	tag, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs
		SET status = 'cancelled', updated_at = `+nowText+`
		WHERE id = $1 AND status IN ('queued', 'pending')`, id)
	if err != nil {
		return false, fmt.Errorf("cancel ingest job: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (d *DB) RetryIngestJob(id string) (*store.IngestJob, error) {
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

	tag, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs SET
			status = 'queued',
			error = '',
			error_code = '',
			error_message = '',
			missing_dependency = '',
			remediation = '',
			result_summary = '',
			runner_id = '',
			heartbeat_at = '',
			retries = retries + 1,
			updated_at = `+nowText+`
		WHERE id = $1 AND status IN ('failed', 'cancelled')`, id)
	if err != nil {
		return nil, fmt.Errorf("requeue ingest job: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("only failed and cancelled jobs can be retried")
	}
	return d.GetIngestJob(id)
}

var recoverStaleJobsSQL = `
	UPDATE ingest_jobs SET
		status = 'queued',
		error = '', error_code = '', error_message = '',
		missing_dependency = '', remediation = '', result_summary = '',
		runner_id = '', heartbeat_at = '',
		updated_at = ` + nowText + `
	WHERE status = 'running'
	AND (heartbeat_at = '' OR heartbeat_at < ` + ingestStaleCutoff + `)`

// RecoverStaleRunningJobs requeues running jobs with expired heartbeats.
// Returns IDs of recovered jobs.
func (d *DB) RecoverStaleRunningJobs() ([]string, error) {
	rows, err := d.pool.Query(context.Background(), recoverStaleJobsSQL+` RETURNING id`)
	if err != nil {
		return nil, fmt.Errorf("recover stale running jobs: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

// claimConcurrencyLimit mirrors the sqlite rules: serial (parallel disabled)
// allows a single running job, otherwise job_max_concurrent applies.
func (d *DB) claimConcurrencyLimit(ctx context.Context) int {
	parallel := d.ingestConfigValue(ctx, "job_parallel_enabled")
	if parallel != "true" && parallel != "1" {
		return 1
	}
	val := d.ingestConfigValue(ctx, "job_max_concurrent")
	n, err := strconv.Atoi(strings.TrimSpace(val))
	if err != nil || n < 1 {
		return store.DefaultMaxConcurrentJobs
	}
	return n
}

// ClaimNextIngestJob atomically recovers stale jobs, enforces the concurrency
// limit and claims the oldest queued job.
func (d *DB) ClaimNextIngestJob(runnerID string) (*store.IngestJob, error) {
	ctx := context.Background()
	maxConcurrent := d.claimConcurrencyLimit(ctx)

	var claimed *store.IngestJob
	err := d.withTx(ctx, func(tx pgx.Tx) error {
		// Serialize claimers so the concurrency check cannot be raced.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('llmwiki:ingest_jobs:claim'))`); err != nil {
			return fmt.Errorf("lock ingest job claim: %w", err)
		}
		if _, err := tx.Exec(ctx, recoverStaleJobsSQL); err != nil {
			return fmt.Errorf("recover stale in claim: %w", err)
		}

		var active int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM ingest_jobs
			WHERE status = 'running'
			AND heartbeat_at != ''
			AND heartbeat_at >= `+ingestStaleCutoff).Scan(&active); err != nil {
			return fmt.Errorf("count active running: %w", err)
		}
		if active >= maxConcurrent {
			return nil
		}

		job := &store.IngestJob{}
		err := scanIngestJob(tx.QueryRow(ctx, `
			UPDATE ingest_jobs
			SET status = 'running', runner_id = $1,
				heartbeat_at = `+nowText+`, updated_at = `+nowText+`
			WHERE id = (
				SELECT id FROM ingest_jobs
				WHERE status = 'queued'
				ORDER BY created_at ASC, id ASC
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			)
			RETURNING `+ingestJobSelectColumns, runnerID), job)
		if err != nil {
			if isNoRows(err) {
				return nil
			}
			return fmt.Errorf("claim job: %w", err)
		}
		job.Status = normalizeJobStatus(job.Status)
		claimed = job
		return nil
	})
	if err != nil {
		return nil, err
	}
	return claimed, nil
}

// TouchIngestJobHeartbeat refreshes heartbeat for an active job.
func (d *DB) TouchIngestJobHeartbeat(jobID, runnerID string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs
		SET heartbeat_at = `+nowText+`
		WHERE id = $1 AND status = 'running' AND runner_id = $2`,
		jobID, runnerID)
	if err != nil {
		return fmt.Errorf("touch ingest job heartbeat: %w", err)
	}
	return nil
}

// ClearIngestJobLease clears runner fields when job leaves running state.
func (d *DB) ClearIngestJobLease(jobID string) {
	_, _ = d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs SET runner_id = '', heartbeat_at = ''
		WHERE id = $1`, jobID)
}
