package ingest

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type IngestQueue struct {
	db *sql.DB
}

type IngestJob struct {
	ID         string
	SourcePath string
	Status     string
	Retries    int
	MaxRetries int
	CreatedAt  time.Time
	Error      string
}

const queueSchema = `
CREATE TABLE IF NOT EXISTS ingest_jobs (
	id TEXT PRIMARY KEY,
	source_path TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	retries INTEGER NOT NULL DEFAULT 0,
	max_retries INTEGER NOT NULL DEFAULT 3,
	created_at DATETIME NOT NULL DEFAULT (datetime('now')),
	error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status);
`

func NewIngestQueue(dbPath string) (*IngestQueue, error) {
	conn, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL")
	if err != nil {
		return nil, fmt.Errorf("open queue db: %w", err)
	}

	if _, err := conn.Exec(queueSchema); err != nil {
		conn.Close()
		return nil, fmt.Errorf("queue schema: %w", err)
	}

	return &IngestQueue{db: conn}, nil
}

func (q *IngestQueue) Close() error {
	return q.db.Close()
}

func (q *IngestQueue) Enqueue(sourcePath string) (*IngestJob, error) {
	job := &IngestJob{
		ID:         uuid.New().String(),
		SourcePath: sourcePath,
		Status:     "pending",
		MaxRetries: 3,
		CreatedAt:  time.Now(),
	}

	_, err := q.db.Exec(
		"INSERT INTO ingest_jobs (id, source_path, status, max_retries, created_at) VALUES (?, ?, ?, ?, ?)",
		job.ID, job.SourcePath, job.Status, job.MaxRetries, job.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("enqueue: %w", err)
	}

	return job, nil
}

func (q *IngestQueue) Dequeue() (*IngestJob, error) {
	tx, err := q.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var job IngestJob
	err = tx.QueryRow(
		"SELECT id, source_path, status, retries, max_retries, created_at, error FROM ingest_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
	).Scan(&job.ID, &job.SourcePath, &job.Status, &job.Retries, &job.MaxRetries, &job.CreatedAt, &job.Error)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec("UPDATE ingest_jobs SET status = 'processing' WHERE id = ?", job.ID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	job.Status = "processing"
	return &job, nil
}

func (q *IngestQueue) Complete(id string) error {
	_, err := q.db.Exec("UPDATE ingest_jobs SET status = 'done' WHERE id = ?", id)
	return err
}

func (q *IngestQueue) Fail(id string, jobErr error) error {
	tx, err := q.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var retries, maxRetries int
	err = tx.QueryRow("SELECT retries, max_retries FROM ingest_jobs WHERE id = ?", id).Scan(&retries, &maxRetries)
	if err != nil {
		return err
	}

	retries++
	errMsg := ""
	if jobErr != nil {
		errMsg = jobErr.Error()
	}

	newStatus := "failed"
	if retries < maxRetries {
		newStatus = "pending"
	}

	_, err = tx.Exec(
		"UPDATE ingest_jobs SET status = ?, retries = ?, error = ? WHERE id = ?",
		newStatus, retries, errMsg, id,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (q *IngestQueue) Pending() ([]IngestJob, error) {
	rows, err := q.db.Query(
		"SELECT id, source_path, status, retries, max_retries, created_at, error FROM ingest_jobs WHERE status IN ('pending', 'processing') ORDER BY created_at ASC",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []IngestJob
	for rows.Next() {
		var j IngestJob
		if err := rows.Scan(&j.ID, &j.SourcePath, &j.Status, &j.Retries, &j.MaxRetries, &j.CreatedAt, &j.Error); err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}
