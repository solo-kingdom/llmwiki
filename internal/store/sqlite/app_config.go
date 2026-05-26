package sqlite

import "database/sql"

// GetConfig reads a single config value from app_config table.
func (d *DB) GetConfig(key string) (string, error) {
	var value string
	err := d.db.QueryRow(
		`SELECT COALESCE(value, '') FROM app_config WHERE key = ?`, key,
	).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

// SetConfig writes a config value to app_config table (upsert).
func (d *DB) SetConfig(key, value string) error {
	_, err := d.db.Exec(`
		INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
		key, value)
	return err
}

// VCConfig holds version control metadata persisted in app_config.
type VCConfig struct {
	LastCommit string `json:"last_commit"`
}

// GetVCConfig reads version control metadata from app_config.
func (d *DB) GetVCConfig() VCConfig {
	lastCommit, _ := d.GetConfig("vc_last_commit")
	return VCConfig{
		LastCommit: lastCommit,
	}
}

// SetVCLastCommit updates the last commit SHA.
func (d *DB) SetVCLastCommit(sha string) error {
	return d.SetConfig("vc_last_commit", sha)
}

// GetAllConfig reads all config values from app_config table.
func (d *DB) GetAllConfig() (map[string]string, error) {
	rows, err := d.db.Query(`SELECT key, value FROM app_config`)
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
