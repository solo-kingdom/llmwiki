package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// InsertIngestJobEvent appends an event and trims per-job retention.
func (d *DB) InsertIngestJobEvent(jobID, step, phase, message string, payload map[string]any, maxPerJob int) error {
	if maxPerJob <= 0 {
		maxPerJob = store.DefaultJobEventsMaxCount
	}
	payloadJSON := ""
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("marshal event payload: %w", err)
		}
		payloadJSON = string(b)
	}
	_, err := d.pool.Exec(context.Background(), `
		INSERT INTO ingest_job_events (job_id, step, phase, message, payload, created_at)
		VALUES ($1, $2, $3, $4, $5, `+nowText+`)`,
		jobID, step, phase, message, payloadJSON,
	)
	if err != nil {
		return fmt.Errorf("insert ingest job event: %w", err)
	}
	return d.TrimIngestJobEvents(jobID, maxPerJob)
}

// ListIngestJobEvents returns events for a job in chronological order.
func (d *DB) ListIngestJobEvents(jobID string, limit int) ([]store.IngestJobEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	rows, err := d.pool.Query(context.Background(), `
		SELECT id, job_id, step, phase, COALESCE(message, ''), COALESCE(payload, ''), COALESCE(created_at, '')
		FROM ingest_job_events
		WHERE job_id = $1
		ORDER BY id ASC
		LIMIT $2`, jobID, limit)
	if err != nil {
		return nil, fmt.Errorf("list ingest job events: %w", err)
	}
	defer rows.Close()

	var events []store.IngestJobEvent
	for rows.Next() {
		var e store.IngestJobEvent
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
	_, err := d.pool.Exec(context.Background(), `
		DELETE FROM ingest_job_events
		WHERE job_id = $1
		AND id NOT IN (
			SELECT id FROM ingest_job_events
			WHERE job_id = $2
			ORDER BY id DESC
			LIMIT $3
		)`, jobID, jobID, maxCount)
	if err != nil {
		return fmt.Errorf("trim ingest job events: %w", err)
	}
	return nil
}

// TrimAllIngestJobEvents trims every job's events to maxCount.
func (d *DB) TrimAllIngestJobEvents(maxCount int) error {
	rows, err := d.pool.Query(context.Background(), `SELECT DISTINCT job_id FROM ingest_job_events`)
	if err != nil {
		return fmt.Errorf("list job ids for trim: %w", err)
	}
	var jobIDs []string
	for rows.Next() {
		var jobID string
		if err := rows.Scan(&jobID); err != nil {
			rows.Close()
			return err
		}
		jobIDs = append(jobIDs, jobID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, jobID := range jobIDs {
		if err := d.TrimIngestJobEvents(jobID, maxCount); err != nil {
			return err
		}
	}
	return nil
}

// parseJobEventsMaxCount reads a configured retention value and clamps it into
// the supported range.
func parseJobEventsMaxCount(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return store.DefaultJobEventsMaxCount
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return store.DefaultJobEventsMaxCount
	}
	if n < store.MinJobEventsMaxCount {
		return store.MinJobEventsMaxCount
	}
	if n > store.MaxJobEventsMaxCount {
		return store.MaxJobEventsMaxCount
	}
	return n
}

// GetJobEventsMaxCount reads retention from config.
func (d *DB) GetJobEventsMaxCount() int {
	if d == nil {
		return store.DefaultJobEventsMaxCount
	}
	return parseJobEventsMaxCount(d.ingestConfigValue(context.Background(), "ingest_job_events_max_count"))
}
