package sqlite

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ProviderInstance stores a user-added provider configuration with a custom name.
type ProviderInstance struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CatalogID  string `json:"catalog_id"`
	APIKey     string `json:"api_key"`
	APIKeyMask string `json:"api_key_masked,omitempty"`
	BaseURL    string `json:"base_url"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// CreateProviderInstance inserts a new provider instance with an auto-generated ID.
func (d *DB) CreateProviderInstance(inst *ProviderInstance) error {
	if inst == nil {
		return fmt.Errorf("nil provider instance")
	}
	inst.ID = "inst_" + uuid.New().String()[:8]
	if inst.CatalogID == "" {
		return fmt.Errorf("catalog_id is required")
	}
	_, err := d.db.Exec(`
		INSERT INTO provider_instances (id, name, catalog_id, api_key, base_url, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
		inst.ID,
		strings.TrimSpace(inst.Name),
		inst.CatalogID,
		inst.APIKey,
		inst.BaseURL,
	)
	if err != nil {
		return fmt.Errorf("create provider instance: %w", err)
	}
	// Read back to get timestamps
	return d.db.QueryRow(`
		SELECT COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM provider_instances WHERE id = ?`, inst.ID,
	).Scan(&inst.CreatedAt, &inst.UpdatedAt)
}

// GetProviderInstance retrieves a single provider instance by ID.
// Returns nil, nil if not found.
func (d *DB) GetProviderInstance(id string) (*ProviderInstance, error) {
	inst := &ProviderInstance{}
	err := d.db.QueryRow(`
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(catalog_id,''),
		       COALESCE(api_key,''), COALESCE(base_url,''),
		       COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM provider_instances WHERE id = ?`, id,
	).Scan(&inst.ID, &inst.Name, &inst.CatalogID, &inst.APIKey, &inst.BaseURL,
		&inst.CreatedAt, &inst.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return inst, nil
}

// ListProviderInstances returns all provider instances ordered by creation time.
func (d *DB) ListProviderInstances() ([]ProviderInstance, error) {
	rows, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(catalog_id,''),
		       COALESCE(api_key,''), COALESCE(base_url,''),
		       COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM provider_instances ORDER BY datetime(created_at) ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProviderInstance
	for rows.Next() {
		var inst ProviderInstance
		if err := rows.Scan(&inst.ID, &inst.Name, &inst.CatalogID, &inst.APIKey,
			&inst.BaseURL, &inst.CreatedAt, &inst.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, inst)
	}
	return out, rows.Err()
}

// UpdateProviderInstance updates a provider instance. Allows changing catalog_id
// without clearing api_key or base_url.
func (d *DB) UpdateProviderInstance(id, name, catalogID, apiKey, baseURL string) error {
	if name != "" {
		if _, err := d.db.Exec(`UPDATE provider_instances SET name = ?, updated_at = datetime('now') WHERE id = ?`,
			strings.TrimSpace(name), id); err != nil {
			return err
		}
	}
	if catalogID != "" {
		if _, err := d.db.Exec(`UPDATE provider_instances SET catalog_id = ?, updated_at = datetime('now') WHERE id = ?`,
			catalogID, id); err != nil {
			return err
		}
	}
	if apiKey != "" {
		if _, err := d.db.Exec(`UPDATE provider_instances SET api_key = ?, updated_at = datetime('now') WHERE id = ?`,
			apiKey, id); err != nil {
			return err
		}
	}
	if baseURL != "" {
		if _, err := d.db.Exec(`UPDATE provider_instances SET base_url = ?, updated_at = datetime('now') WHERE id = ?`,
			baseURL, id); err != nil {
			return err
		}
	}
	return nil
}

// DeleteProviderInstance removes a provider instance by ID.
func (d *DB) DeleteProviderInstance(id string) error {
	res, err := d.db.Exec(`DELETE FROM provider_instances WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("provider instance not found: %s", id)
	}
	return nil
}
