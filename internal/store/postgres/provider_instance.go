package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// CreateProviderInstance inserts a new provider instance with an auto-generated ID.
func (d *DB) CreateProviderInstance(inst *store.ProviderInstance) error {
	if inst == nil {
		return fmt.Errorf("nil provider instance")
	}
	if inst.ID == "" {
		inst.ID = "inst_" + uuid.New().String()[:8]
	}
	if inst.CatalogID == "" {
		return fmt.Errorf("catalog_id is required")
	}
	err := d.pool.QueryRow(context.Background(), `
		INSERT INTO provider_instances (id, name, catalog_id, api_key, base_url, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, `+nowText+`, `+nowText+`)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name, catalog_id = EXCLUDED.catalog_id,
			api_key = EXCLUDED.api_key, base_url = EXCLUDED.base_url,
			updated_at = EXCLUDED.updated_at
		RETURNING created_at, updated_at`,
		inst.ID,
		strings.TrimSpace(inst.Name),
		inst.CatalogID,
		inst.APIKey,
		inst.BaseURL,
	).Scan(&inst.CreatedAt, &inst.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create provider instance: %w", err)
	}
	return nil
}

// GetProviderInstance retrieves a single provider instance by ID.
// Returns nil, nil if not found. The API key is returned unmasked; masking is
// the API layer's responsibility.
func (d *DB) GetProviderInstance(id string) (*store.ProviderInstance, error) {
	inst := &store.ProviderInstance{}
	err := d.pool.QueryRow(context.Background(), `
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(catalog_id,''),
		       COALESCE(api_key,''), COALESCE(base_url,''),
		       COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM provider_instances WHERE id = $1`, id,
	).Scan(&inst.ID, &inst.Name, &inst.CatalogID, &inst.APIKey, &inst.BaseURL,
		&inst.CreatedAt, &inst.UpdatedAt)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return inst, nil
}

// ListProviderInstances returns all provider instances ordered by creation time.
func (d *DB) ListProviderInstances() ([]store.ProviderInstance, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(catalog_id,''),
		       COALESCE(api_key,''), COALESCE(base_url,''),
		       COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM provider_instances ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []store.ProviderInstance
	for rows.Next() {
		var inst store.ProviderInstance
		if err := rows.Scan(&inst.ID, &inst.Name, &inst.CatalogID, &inst.APIKey,
			&inst.BaseURL, &inst.CreatedAt, &inst.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, inst)
	}
	return out, rows.Err()
}

// UpdateProviderInstance updates a provider instance. Allows changing catalog_id
// without clearing api_key or base_url; empty fields are left untouched.
func (d *DB) UpdateProviderInstance(id, name, catalogID, apiKey, baseURL string) error {
	ctx := context.Background()
	if name != "" {
		if _, err := d.pool.Exec(ctx,
			`UPDATE provider_instances SET name = $1, updated_at = `+nowText+` WHERE id = $2`,
			strings.TrimSpace(name), id); err != nil {
			return err
		}
	}
	if catalogID != "" {
		if _, err := d.pool.Exec(ctx,
			`UPDATE provider_instances SET catalog_id = $1, updated_at = `+nowText+` WHERE id = $2`,
			catalogID, id); err != nil {
			return err
		}
	}
	if apiKey != "" {
		if _, err := d.pool.Exec(ctx,
			`UPDATE provider_instances SET api_key = $1, updated_at = `+nowText+` WHERE id = $2`,
			apiKey, id); err != nil {
			return err
		}
	}
	if baseURL != "" {
		if _, err := d.pool.Exec(ctx,
			`UPDATE provider_instances SET base_url = $1, updated_at = `+nowText+` WHERE id = $2`,
			baseURL, id); err != nil {
			return err
		}
	}
	return nil
}

// DeleteProviderInstance removes a provider instance by ID.
func (d *DB) DeleteProviderInstance(id string) error {
	tag, err := d.pool.Exec(context.Background(),
		`DELETE FROM provider_instances WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("provider instance not found: %s", id)
	}
	return nil
}
