package postgres

import (
	"context"
	"strconv"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// GetConfig reads a single config value. A missing key yields "" and no error,
// matching the SQLite store's semantics.
func (d *DB) GetConfig(key string) (string, error) {
	var value string
	err := d.pool.QueryRow(context.Background(),
		`SELECT COALESCE(value, '') FROM app_config WHERE key = $1`, key,
	).Scan(&value)
	if isNoRows(err) {
		return "", nil
	}
	return value, err
}

// SetConfig writes a config value (upsert).
func (d *DB) SetConfig(key, value string) error {
	_, err := d.pool.Exec(context.Background(), `
		INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, `+nowText+`)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = `+nowText,
		key, value)
	return err
}

// GetAllConfig reads every config entry.
func (d *DB) GetAllConfig() (map[string]string, error) {
	rows, err := d.pool.Query(context.Background(), `SELECT key, value FROM app_config`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	m := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		m[k] = v
	}
	return m, rows.Err()
}

// MaxConcurrentJobs returns the configured worker count. Anything missing,
// unparsable or below 1 falls back to store.DefaultMaxConcurrentJobs.
func (d *DB) MaxConcurrentJobs() int {
	val, err := d.GetConfig("job_max_concurrent")
	if err != nil || val == "" {
		return store.DefaultMaxConcurrentJobs
	}
	n, err := strconv.Atoi(val)
	if err != nil || n < 1 {
		return store.DefaultMaxConcurrentJobs
	}
	return n
}

// ParallelEnabled reports whether parallel job execution is enabled via config.
func (d *DB) ParallelEnabled() bool {
	val, _ := d.GetConfig("job_parallel_enabled")
	return val == "true" || val == "1"
}
