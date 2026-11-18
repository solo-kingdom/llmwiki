package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

var validActivityLevels = map[string]bool{
	"debug": true, "info": true, "warn": true, "error": true,
}

func normalizeActivityLevel(level string) string {
	l := strings.ToLower(strings.TrimSpace(level))
	if l == "" || !validActivityLevels[l] {
		return "info"
	}
	return l
}

const activityLogSelectCols = `
	COALESCE(id, 0), COALESCE(created_at, ''), COALESCE(level, 'info'),
	COALESCE(category, ''), COALESCE(action, ''), COALESCE(message, ''),
	COALESCE(resource_type, ''), COALESCE(resource_id, ''), COALESCE(status, ''),
	COALESCE(details, ''), COALESCE(source, '')`

func scanActivityLog(scanner interface{ Scan(...any) error }, log *store.ActivityLog) error {
	return scanner.Scan(
		&log.ID,
		&log.CreatedAt,
		&log.Level,
		&log.Category,
		&log.Action,
		&log.Message,
		&log.ResourceType,
		&log.ResourceID,
		&log.Status,
		&log.Details,
		&log.Source,
	)
}

// CreateActivityLog inserts a new activity log row and fills log with the stored values.
func (d *DB) CreateActivityLog(log *store.ActivityLog) error {
	if log == nil {
		return fmt.Errorf("nil activity log")
	}
	log.Level = normalizeActivityLevel(log.Level)
	if log.Category == "" {
		return fmt.Errorf("category is required")
	}
	if log.Action == "" {
		return fmt.Errorf("action is required")
	}

	row := d.pool.QueryRow(context.Background(), `
		INSERT INTO activity_logs (
			level, category, action, message,
			resource_type, resource_id, status, details, source, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, `+nowText+`)
		RETURNING `+activityLogSelectCols,
		log.Level,
		log.Category,
		log.Action,
		log.Message,
		log.ResourceType,
		log.ResourceID,
		log.Status,
		log.Details,
		log.Source,
	)
	if err := scanActivityLog(row, log); err != nil {
		return fmt.Errorf("create activity log: %w", err)
	}
	return nil
}

// ListActivityLogs returns logs matching filter, newest first.
func (d *DB) ListActivityLogs(f store.ActivityLogListFilter) ([]store.ActivityLog, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	query := `SELECT ` + activityLogSelectCols + ` FROM activity_logs WHERE 1=1`
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

	if cat := strings.TrimSpace(f.Category); cat != "" {
		query += ` AND category = ` + arg(cat)
	}
	if lvl := strings.TrimSpace(f.Level); lvl != "" {
		query += ` AND level = ` + arg(normalizeActivityLevel(lvl))
	}
	query += ` ORDER BY created_at DESC, id DESC LIMIT ` + arg(limit) + ` OFFSET ` + arg(offset)

	rows, err := d.pool.Query(context.Background(), query, args...)
	if err != nil {
		return nil, fmt.Errorf("list activity logs: %w", err)
	}
	defer rows.Close()

	logs := make([]store.ActivityLog, 0, limit)
	for rows.Next() {
		var log store.ActivityLog
		if err := scanActivityLog(rows, &log); err != nil {
			return nil, fmt.Errorf("scan activity log: %w", err)
		}
		logs = append(logs, log)
	}
	return logs, rows.Err()
}

// CountActivityLogs returns total rows, optionally filtered by category/level.
func (d *DB) CountActivityLogs(category, level string) (int, error) {
	query := `SELECT COUNT(*) FROM activity_logs WHERE 1=1`
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if cat := strings.TrimSpace(category); cat != "" {
		query += ` AND category = ` + arg(cat)
	}
	if lvl := strings.TrimSpace(level); lvl != "" {
		query += ` AND level = ` + arg(normalizeActivityLevel(lvl))
	}
	var count int
	if err := d.pool.QueryRow(context.Background(), query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("count activity logs: %w", err)
	}
	return count, nil
}

// DeleteAllActivityLogs removes all activity log rows.
func (d *DB) DeleteAllActivityLogs() (int64, error) {
	tag, err := d.pool.Exec(context.Background(), `DELETE FROM activity_logs`)
	if err != nil {
		return 0, fmt.Errorf("delete all activity logs: %w", err)
	}
	return tag.RowsAffected(), nil
}

// TrimActivityLogs deletes the oldest rows until at most maxCount remain.
func (d *DB) TrimActivityLogs(maxCount int) (int64, error) {
	if maxCount < 0 {
		return 0, fmt.Errorf("maxCount must be non-negative")
	}
	count, err := d.CountActivityLogs("", "")
	if err != nil {
		return 0, err
	}
	if count <= maxCount {
		return 0, nil
	}
	toDelete := count - maxCount
	tag, err := d.pool.Exec(context.Background(), `
		DELETE FROM activity_logs WHERE id IN (
			SELECT id FROM activity_logs ORDER BY created_at ASC, id ASC LIMIT $1
		)`, toDelete)
	if err != nil {
		return 0, fmt.Errorf("trim activity logs: %w", err)
	}
	return tag.RowsAffected(), nil
}

// GetActivityLog returns a single log by id. Returns nil, nil if absent.
func (d *DB) GetActivityLog(id int64) (*store.ActivityLog, error) {
	log := &store.ActivityLog{}
	err := scanActivityLog(d.pool.QueryRow(context.Background(),
		`SELECT `+activityLogSelectCols+` FROM activity_logs WHERE id = $1`, id), log)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get activity log: %w", err)
	}
	return log, nil
}
