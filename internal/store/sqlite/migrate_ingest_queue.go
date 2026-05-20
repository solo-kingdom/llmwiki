package sqlite

import (
	"strings"
)

func (d *DB) migrateIngestQueue() error {
	if err := d.addColumnIgnoreDuplicate("ingest_jobs", "runner_id", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := d.addColumnIgnoreDuplicate("ingest_jobs", "heartbeat_at", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS ingest_job_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			job_id TEXT NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE,
			step TEXT NOT NULL,
			phase TEXT NOT NULL,
			message TEXT NOT NULL DEFAULT '',
			payload TEXT NOT NULL DEFAULT '',
			created_at TEXT DEFAULT (datetime('now'))
		);
		CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON ingest_job_events(job_id, id DESC);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_one_running ON ingest_jobs(status) WHERE status = 'running';
	`)
	return err
}

func (d *DB) addColumnIgnoreDuplicate(table, column, def string) error {
	_, err := d.db.Exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + def)
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		return nil
	}
	return err
}

// StaleHeartbeatSeconds is how long without heartbeat before a running job is stale.
const StaleHeartbeatSeconds = 120
