package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/solo-kingdom/llmwiki/internal/store"
)

// UpsertProviderInfo replaces all provider info cache entries with the given slice.
func (d *DB) UpsertProviderInfo(providers []store.ProviderInfo) error {
	ctx := context.Background()
	return d.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM provider_info_cache`); err != nil {
			return err
		}
		for _, p := range providers {
			if _, err := tx.Exec(ctx, `
				INSERT INTO provider_info_cache (id, name, api_base, api_format, env_key, doc_url)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				p.ID, p.Name, p.APIBase, p.APIFormat, p.EnvKey, p.DocURL); err != nil {
				return err
			}
		}
		return nil
	})
}

// UpsertModels replaces all model cache entries for the given providers with the given slice.
func (d *DB) UpsertModels(models []store.ModelInfo) error {
	ctx := context.Background()
	return d.withTx(ctx, func(tx pgx.Tx) error {
		providerSet := make(map[string]bool)
		for _, m := range models {
			providerSet[m.ProviderID] = true
		}
		for pid := range providerSet {
			if _, err := tx.Exec(ctx,
				`DELETE FROM provider_models_cache WHERE provider_id = $1`, pid); err != nil {
				return err
			}
		}
		for _, m := range models {
			if _, err := tx.Exec(ctx, `
				INSERT INTO provider_models_cache
					(provider_id, model_id, name, family, context_limit, output_limit,
					 cost_input, cost_output, reasoning, tool_call, attachment, modalities)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
				m.ProviderID, m.ModelID, m.Name, m.Family,
				m.ContextLimit, m.OutputLimit,
				m.CostInput, m.CostOutput,
				m.Reasoning, m.ToolCall, m.Attachment, m.Modalities); err != nil {
				return err
			}
		}
		return nil
	})
}

// ListProviders returns all cached providers, ordered by name.
func (d *DB) ListProviders() ([]store.ProviderInfo, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(api_base,''),
		       COALESCE(api_format,'openai'), COALESCE(env_key,''), COALESCE(doc_url,'')
		FROM provider_info_cache ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []store.ProviderInfo
	for rows.Next() {
		var p store.ProviderInfo
		if err := rows.Scan(&p.ID, &p.Name, &p.APIBase, &p.APIFormat, &p.EnvKey, &p.DocURL); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListModelsByProvider returns all cached models for a given provider, ordered by name.
func (d *DB) ListModelsByProvider(providerID string) ([]store.ModelInfo, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT provider_id, model_id, COALESCE(name,''), COALESCE(family,''),
		       context_limit, output_limit, cost_input, cost_output,
		       reasoning, tool_call, attachment, COALESCE(modalities,'{}')
		FROM provider_models_cache WHERE provider_id = $1 ORDER BY name`,
		providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []store.ModelInfo
	for rows.Next() {
		var m store.ModelInfo
		if err := rows.Scan(&m.ProviderID, &m.ModelID, &m.Name, &m.Family,
			&m.ContextLimit, &m.OutputLimit, &m.CostInput, &m.CostOutput,
			&m.Reasoning, &m.ToolCall, &m.Attachment, &m.Modalities); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetProviderInfo returns a single provider's cached info. Returns nil, nil if absent.
func (d *DB) GetProviderInfo(providerID string) (*store.ProviderInfo, error) {
	var p store.ProviderInfo
	err := d.pool.QueryRow(context.Background(), `
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(api_base,''),
		       COALESCE(api_format,'openai'), COALESCE(env_key,''), COALESCE(doc_url,'')
		FROM provider_info_cache WHERE id = $1`, providerID,
	).Scan(&p.ID, &p.Name, &p.APIBase, &p.APIFormat, &p.EnvKey, &p.DocURL)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CacheIsEmpty checks if the provider cache has any entries.
func (d *DB) CacheIsEmpty() (bool, error) {
	var count int
	err := d.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM provider_info_cache`).Scan(&count)
	return count == 0, err
}
