package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// MarkIngestJobSucceeded finalizes a job and clears its lease.
func (d *DB) MarkIngestJobSucceeded(id, summary string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs SET status='succeeded', result_summary=$2,
			runner_id='', heartbeat_at='', updated_at=(`+nowText+`)
		WHERE id=$1`, id, summary)
	return err
}

// ResetIngestJobToQueued requeues a running job and clears its error/lease fields.
func (d *DB) ResetIngestJobToQueued(id string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_jobs SET status='queued', error='', error_code='', error_message='',
			missing_dependency='', remediation='', result_summary='',
			runner_id='', heartbeat_at='', updated_at=(`+nowText+`)
		WHERE id=$1 AND status='running'`, id)
	return err
}

// DeleteIngestJob removes a job row (cascades events).
func (d *DB) DeleteIngestJob(id string) error {
	_, err := d.pool.Exec(context.Background(), `DELETE FROM ingest_jobs WHERE id=$1`, id)
	return err
}

// UpdateIngestSessionStatusAndTitle updates both fields atomically.
func (d *DB) UpdateIngestSessionStatusAndTitle(id, status, title string) error {
	return d.withTx(context.Background(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(context.Background(), `UPDATE ingest_sessions SET status=$2, updated_at=(`+nowText+`) WHERE id=$1`, id, status); err != nil {
			return err
		}
		if title != "" {
			if _, err := tx.Exec(context.Background(), `UPDATE ingest_sessions SET title=$2, updated_at=(`+nowText+`) WHERE id=$1`, id, title); err != nil {
				return err
			}
		}
		return nil
	})
}
