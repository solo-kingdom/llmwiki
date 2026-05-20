package sqlite

import (
	"database/sql"
	"fmt"
)

// RecoverStaleRunningJobs requeues running jobs with expired heartbeats.
// Returns IDs of recovered jobs.
func (d *DB) RecoverStaleRunningJobs() ([]string, error) {
	rows, err := d.db.Query(`
		SELECT id FROM ingest_jobs
		WHERE status = 'running'
		AND (
			heartbeat_at = ''
			OR heartbeat_at IS NULL
			OR heartbeat_at < datetime('now', ?)
		)`, fmt.Sprintf("-%d seconds", StaleHeartbeatSeconds))
	if err != nil {
		return nil, fmt.Errorf("list stale running jobs: %w", err)
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
	if len(ids) == 0 {
		return nil, nil
	}

	_, err = d.db.Exec(`
		UPDATE ingest_jobs SET
			status = 'queued',
			error = '', error_code = '', error_message = '',
			missing_dependency = '', remediation = '', result_summary = '',
			runner_id = '', heartbeat_at = '',
			updated_at = datetime('now')
		WHERE status = 'running'
		AND (
			heartbeat_at = ''
			OR heartbeat_at IS NULL
			OR heartbeat_at < datetime('now', ?)
		)`, fmt.Sprintf("-%d seconds", StaleHeartbeatSeconds))
	if err != nil {
		return nil, fmt.Errorf("recover stale running jobs: %w", err)
	}
	return ids, nil
}

// ClaimNextIngestJob atomically recovers stale jobs and claims the oldest queued job.
func (d *DB) ClaimNextIngestJob(runnerID string) (*IngestJob, error) {
	tx, err := d.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		UPDATE ingest_jobs SET
			status = 'queued',
			error = '', error_code = '', error_message = '',
			missing_dependency = '', remediation = '', result_summary = '',
			runner_id = '', heartbeat_at = '',
			updated_at = datetime('now')
		WHERE status = 'running'
		AND (
			heartbeat_at = ''
			OR heartbeat_at IS NULL
			OR heartbeat_at < datetime('now', ?)
		)`, fmt.Sprintf("-%d seconds", StaleHeartbeatSeconds)); err != nil {
		return nil, fmt.Errorf("recover stale in claim: %w", err)
	}

	var active int
	err = tx.QueryRow(`
		SELECT COUNT(*) FROM ingest_jobs
		WHERE status = 'running'
		AND heartbeat_at != ''
		AND heartbeat_at >= datetime('now', ?)`,
		fmt.Sprintf("-%d seconds", StaleHeartbeatSeconds)).Scan(&active)
	if err != nil {
		return nil, fmt.Errorf("count active running: %w", err)
	}
	if active > 0 {
		return nil, nil
	}

	var jobID string
	err = tx.QueryRow(`
		SELECT id FROM ingest_jobs
		WHERE status = 'queued'
		ORDER BY datetime(created_at) ASC
		LIMIT 1`).Scan(&jobID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("select queued job: %w", err)
	}

	result, err := tx.Exec(`
		UPDATE ingest_jobs
		SET status = 'running', runner_id = ?, heartbeat_at = datetime('now'), updated_at = datetime('now')
		WHERE id = ? AND status = 'queued'`, runnerID, jobID)
	if err != nil {
		return nil, fmt.Errorf("claim job: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, nil
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return d.GetIngestJob(jobID)
}

// TouchIngestJobHeartbeat refreshes heartbeat for an active job.
func (d *DB) TouchIngestJobHeartbeat(jobID, runnerID string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_jobs
		SET heartbeat_at = datetime('now')
		WHERE id = ? AND status = 'running' AND runner_id = ?`,
		jobID, runnerID)
	return err
}

// ClearIngestJobLease clears runner fields when job leaves running state.
func (d *DB) ClearIngestJobLease(jobID string) {
	_, _ = d.db.Exec(`
		UPDATE ingest_jobs SET runner_id = '', heartbeat_at = ''
		WHERE id = ?`, jobID)
}
