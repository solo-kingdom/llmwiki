package sqlite

import "database/sql"

// ProviderKey stores per-provider API credentials.
type ProviderKey struct {
	ProviderID string `json:"provider_id"`
	APIKey     string `json:"api_key"`
	BaseURL    string `json:"base_url"`
}

// SetProviderKey stores or updates a provider's API key and optional base URL.
func (d *DB) SetProviderKey(providerID, apiKey, baseURL string) error {
	_, err := d.db.Exec(`
		INSERT INTO provider_keys (provider_id, api_key, base_url, updated_at)
		VALUES (?, ?, ?, datetime('now'))
		ON CONFLICT(provider_id) DO UPDATE SET
			api_key = excluded.api_key,
			base_url = excluded.base_url,
			updated_at = datetime('now')`,
		providerID, apiKey, baseURL)
	return err
}

// GetProviderKey retrieves a provider's API key and base URL.
// Returns ("", "", nil) if not found.
func (d *DB) GetProviderKey(providerID string) (apiKey, baseURL string, err error) {
	err = d.db.QueryRow(
		`SELECT COALESCE(api_key,''), COALESCE(base_url,'') FROM provider_keys WHERE provider_id = ?`,
		providerID,
	).Scan(&apiKey, &baseURL)
	if err == sql.ErrNoRows {
		return "", "", nil
	}
	return
}

// DeleteProviderKey removes a provider's stored credentials.
func (d *DB) DeleteProviderKey(providerID string) error {
	_, err := d.db.Exec(`DELETE FROM provider_keys WHERE provider_id = ?`, providerID)
	return err
}

// ListProviderKeys returns all stored provider keys (API keys are included).
func (d *DB) ListProviderKeys() ([]ProviderKey, error) {
	rows, err := d.db.Query(
		`SELECT provider_id, COALESCE(api_key,''), COALESCE(base_url,'') FROM provider_keys`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProviderKey
	for rows.Next() {
		var pk ProviderKey
		if err := rows.Scan(&pk.ProviderID, &pk.APIKey, &pk.BaseURL); err != nil {
			return nil, err
		}
		out = append(out, pk)
	}
	return out, rows.Err()
}

// HasProviderKey checks if a provider has a stored API key.
func (d *DB) HasProviderKey(providerID string) (bool, error) {
	var count int
	err := d.db.QueryRow(
		`SELECT COUNT(*) FROM provider_keys WHERE provider_id = ? AND api_key != ''`,
		providerID,
	).Scan(&count)
	return count > 0, err
}
