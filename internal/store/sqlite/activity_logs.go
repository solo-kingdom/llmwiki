package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
)

// ActivityLog is a persisted system activity record.
type ActivityLog struct {
	ID           int64  `json:"id"`
	CreatedAt    string `json:"created_at"`
	Level        string `json:"level"`
	Category     string `json:"category"`
	Action       string `json:"action"`
	Message      string `json:"message"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	Status       string `json:"status"`
	Details      string `json:"details"`
	Source       string `json:"source"`
}

// ActivityLogListFilter filters activity log queries.
type ActivityLogListFilter struct {
	Limit    int
	Offset   int
	Category string
	Level    string
}

var validActivityLevels = map[string]bool{
	"debug": true, "info": true, "warn": true, "error": true,
}

func normalizeActivityLevel(level string) string {
	l := strings.ToLower(strings.TrimSpace(level))
	if l == "" {
		return "info"
	}
	if validActivityLevels[l] {
		return l
	}
	return "info"
}

func scanActivityLog(scanner interface{ Scan(...interface{}) error }, log *ActivityLog) error {
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

const activityLogSelectCols = `
	COALESCE(id, 0), COALESCE(created_at, ''), COALESCE(level, 'info'),
	COALESCE(category, ''), COALESCE(action, ''), COALESCE(message, ''),
	COALESCE(resource_type, ''), COALESCE(resource_id, ''), COALESCE(status, ''),
	COALESCE(details, ''), COALESCE(source, '')`

// CreateActivityLog inserts a new activity log row.
func (d *DB) CreateActivityLog(log *ActivityLog) error {
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

	result, err := d.db.Exec(`
		INSERT INTO activity_logs (
			level, category, action, message,
			resource_type, resource_id, status, details, source, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
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
	if err != nil {
		return fmt.Errorf("create activity log: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return fmt.Errorf("activity log last insert id: %w", err)
	}
	log.ID = id

	row := d.db.QueryRow(`
		SELECT `+activityLogSelectCols+`
		FROM activity_logs WHERE id = ?`, id)
	if err := scanActivityLog(row, log); err != nil {
		return fmt.Errorf("fetch created activity log: %w", err)
	}
	return nil
}

// ListActivityLogs returns logs matching filter, newest first.
func (d *DB) ListActivityLogs(f ActivityLogListFilter) ([]ActivityLog, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	query := `SELECT ` + activityLogSelectCols + ` FROM activity_logs WHERE 1=1`
	args := []interface{}{}

	if cat := strings.TrimSpace(f.Category); cat != "" {
		query += ` AND category = ?`
		args = append(args, cat)
	}
	if lvl := strings.TrimSpace(f.Level); lvl != "" {
		query += ` AND level = ?`
		args = append(args, normalizeActivityLevel(lvl))
	}
	query += ` ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)

	rows, err := d.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list activity logs: %w", err)
	}
	defer rows.Close()

	logs := make([]ActivityLog, 0, limit)
	for rows.Next() {
		var log ActivityLog
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
	args := []interface{}{}
	if cat := strings.TrimSpace(category); cat != "" {
		query += ` AND category = ?`
		args = append(args, cat)
	}
	if lvl := strings.TrimSpace(level); lvl != "" {
		query += ` AND level = ?`
		args = append(args, normalizeActivityLevel(lvl))
	}
	var count int
	err := d.db.QueryRow(query, args...).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count activity logs: %w", err)
	}
	return count, nil
}

// DeleteAllActivityLogs removes all activity log rows.
func (d *DB) DeleteAllActivityLogs() (int64, error) {
	result, err := d.db.Exec(`DELETE FROM activity_logs`)
	if err != nil {
		return 0, fmt.Errorf("delete all activity logs: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("delete all activity logs rows: %w", err)
	}
	return n, nil
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
	result, err := d.db.Exec(`
		DELETE FROM activity_logs WHERE id IN (
			SELECT id FROM activity_logs ORDER BY datetime(created_at) ASC LIMIT ?
		)`, toDelete)
	if err != nil {
		return 0, fmt.Errorf("trim activity logs: %w", err)
	}
	return result.RowsAffected()
}

// GetActivityLog returns a single log by id.
func (d *DB) GetActivityLog(id int64) (*ActivityLog, error) {
	log := &ActivityLog{}
	err := scanActivityLog(d.db.QueryRow(`
		SELECT `+activityLogSelectCols+`
		FROM activity_logs WHERE id = ?`, id), log)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get activity log: %w", err)
	}
	return log, nil
}
