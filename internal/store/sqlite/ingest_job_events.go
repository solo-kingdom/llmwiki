package sqlite

import (
	"encoding/json"
	"fmt"
	"strings"
)

// IngestJobEvent is a single execution trace row for an ingest job.
type IngestJobEvent struct {
	ID        int64  `json:"id"`
	JobID     string `json:"job_id"`
	Step      string `json:"step"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	Payload   string `json:"payload"`
	CreatedAt string `json:"created_at"`
}

// InsertIngestJobEvent appends an event and trims per-job retention.
func (d *DB) InsertIngestJobEvent(jobID, step, phase, message string, payload map[string]any, maxPerJob int) error {
	if maxPerJob <= 0 {
		maxPerJob = DefaultJobEventsMaxCount
	}
	payloadJSON := ""
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("marshal event payload: %w", err)
		}
		payloadJSON = string(b)
	}
	_, err := d.db.Exec(`
		INSERT INTO ingest_job_events (job_id, step, phase, message, payload, created_at)
		VALUES (?, ?, ?, ?, ?, datetime('now'))`,
		jobID, step, phase, message, payloadJSON,
	)
	if err != nil {
		return fmt.Errorf("insert ingest job event: %w", err)
	}
	return d.TrimIngestJobEvents(jobID, maxPerJob)
}

// ListIngestJobEvents returns events for a job in chronological order.
func (d *DB) ListIngestJobEvents(jobID string, limit int) ([]IngestJobEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	rows, err := d.db.Query(`
		SELECT id, job_id, step, phase, COALESCE(message, ''), COALESCE(payload, ''), COALESCE(created_at, '')
		FROM ingest_job_events
		WHERE job_id = ?
		ORDER BY id ASC
		LIMIT ?`, jobID, limit)
	if err != nil {
		return nil, fmt.Errorf("list ingest job events: %w", err)
	}
	defer rows.Close()

	var events []IngestJobEvent
	for rows.Next() {
		var e IngestJobEvent
		if err := rows.Scan(&e.ID, &e.JobID, &e.Step, &e.Phase, &e.Message, &e.Payload, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan ingest job event: %w", err)
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// TrimIngestJobEvents keeps only the newest maxCount events for a job.
func (d *DB) TrimIngestJobEvents(jobID string, maxCount int) error {
	if maxCount <= 0 {
		return nil
	}
	_, err := d.db.Exec(`
		DELETE FROM ingest_job_events
		WHERE job_id = ?
		AND id NOT IN (
			SELECT id FROM ingest_job_events
			WHERE job_id = ?
			ORDER BY id DESC
			LIMIT ?
		)`, jobID, jobID, maxCount)
	if err != nil {
		return fmt.Errorf("trim ingest job events: %w", err)
	}
	return nil
}

// TrimAllIngestJobEvents trims every job's events to maxCount.
func (d *DB) TrimAllIngestJobEvents(maxCount int) error {
	rows, err := d.db.Query(`SELECT DISTINCT job_id FROM ingest_job_events`)
	if err != nil {
		return fmt.Errorf("list job ids for trim: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var jobID string
		if err := rows.Scan(&jobID); err != nil {
			return err
		}
		if err := d.TrimIngestJobEvents(jobID, maxCount); err != nil {
			return err
		}
	}
	return rows.Err()
}

const (
	DefaultJobEventsMaxCount = 200
	MinJobEventsMaxCount     = 50
	MaxJobEventsMaxCount     = 2000
)

// ParseJobEventsMaxCount validates configured per-job event retention.
func ParseJobEventsMaxCount(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return DefaultJobEventsMaxCount, nil
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, fmt.Errorf("invalid ingest_job_events_max_count: %q", s)
	}
	if n < MinJobEventsMaxCount || n > MaxJobEventsMaxCount {
		return 0, fmt.Errorf("ingest_job_events_max_count must be between %d and %d", MinJobEventsMaxCount, MaxJobEventsMaxCount)
	}
	return n, nil
}

// GetJobEventsMaxCount reads retention from config.
func (d *DB) GetJobEventsMaxCount() int {
	if d == nil {
		return DefaultJobEventsMaxCount
	}
	raw, _ := d.GetConfig("ingest_job_events_max_count")
	n, err := ParseJobEventsMaxCount(raw)
	if err != nil {
		return DefaultJobEventsMaxCount
	}
	return n
}
