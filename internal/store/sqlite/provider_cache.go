package sqlite

import "database/sql"

// ProviderInfo holds cached metadata for a single provider.
type ProviderInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	APIBase   string `json:"api_base"`
	APIFormat string `json:"api_format"`
	EnvKey    string `json:"env_key"`
	DocURL    string `json:"doc_url"`
}

// ModelInfo holds cached metadata for a single model.
type ModelInfo struct {
	ProviderID   string  `json:"provider_id"`
	ModelID      string  `json:"model_id"`
	Name         string  `json:"name"`
	Family       string  `json:"family"`
	ContextLimit int     `json:"context_limit"`
	OutputLimit  int     `json:"output_limit"`
	CostInput    float64 `json:"cost_input"`
	CostOutput   float64 `json:"cost_output"`
	Reasoning    bool    `json:"reasoning"`
	ToolCall     bool    `json:"tool_call"`
	Attachment   bool    `json:"attachment"`
	Modalities   string  `json:"modalities"`
}

// UpsertProviderInfo replaces all provider info cache entries with the given slice.
func (d *DB) UpsertProviderInfo(providers []ProviderInfo) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM provider_info_cache`); err != nil {
		return err
	}
	for _, p := range providers {
		_, err := tx.Exec(`
			INSERT INTO provider_info_cache (id, name, api_base, api_format, env_key, doc_url)
			VALUES (?, ?, ?, ?, ?, ?)`,
			p.ID, p.Name, p.APIBase, p.APIFormat, p.EnvKey, p.DocURL)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// UpsertModels replaces all model cache entries for the given providers with the given slice.
func (d *DB) UpsertModels(models []ModelInfo) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Collect unique provider IDs to clear old models
	providerSet := make(map[string]bool)
	for _, m := range models {
		providerSet[m.ProviderID] = true
	}
	for pid := range providerSet {
		if _, err := tx.Exec(`DELETE FROM provider_models_cache WHERE provider_id = ?`, pid); err != nil {
			return err
		}
	}

	for _, m := range models {
		_, err := tx.Exec(`
			INSERT INTO provider_models_cache
				(provider_id, model_id, name, family, context_limit, output_limit,
				 cost_input, cost_output, reasoning, tool_call, attachment, modalities)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			m.ProviderID, m.ModelID, m.Name, m.Family,
			m.ContextLimit, m.OutputLimit,
			m.CostInput, m.CostOutput,
			m.Reasoning, m.ToolCall, m.Attachment, m.Modalities)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListProviders returns all cached providers.
func (d *DB) ListProviders() ([]ProviderInfo, error) {
	rows, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(api_base,''),
		       COALESCE(api_format,'openai'), COALESCE(env_key,''), COALESCE(doc_url,'')
		FROM provider_info_cache ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProviderInfo
	for rows.Next() {
		var p ProviderInfo
		if err := rows.Scan(&p.ID, &p.Name, &p.APIBase, &p.APIFormat, &p.EnvKey, &p.DocURL); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListModelsByProvider returns all cached models for a given provider.
func (d *DB) ListModelsByProvider(providerID string) ([]ModelInfo, error) {
	rows, err := d.db.Query(`
		SELECT provider_id, model_id, COALESCE(name,''), COALESCE(family,''),
		       context_limit, output_limit, cost_input, cost_output,
		       reasoning, tool_call, attachment, COALESCE(modalities,'{}')
		FROM provider_models_cache WHERE provider_id = ? ORDER BY name`,
		providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ModelInfo
	for rows.Next() {
		var m ModelInfo
		var reasoning, toolCall, attachment int
		if err := rows.Scan(&m.ProviderID, &m.ModelID, &m.Name, &m.Family,
			&m.ContextLimit, &m.OutputLimit, &m.CostInput, &m.CostOutput,
			&reasoning, &toolCall, &attachment, &m.Modalities); err != nil {
			return nil, err
		}
		m.Reasoning = reasoning != 0
		m.ToolCall = toolCall != 0
		m.Attachment = attachment != 0
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetProviderInfo returns a single provider's cached info.
func (d *DB) GetProviderInfo(providerID string) (*ProviderInfo, error) {
	var p ProviderInfo
	err := d.db.QueryRow(`
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(api_base,''),
		       COALESCE(api_format,'openai'), COALESCE(env_key,''), COALESCE(doc_url,'')
		FROM provider_info_cache WHERE id = ?`, providerID,
	).Scan(&p.ID, &p.Name, &p.APIBase, &p.APIFormat, &p.EnvKey, &p.DocURL)
	if err == sql.ErrNoRows {
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
	err := d.db.QueryRow(`SELECT COUNT(*) FROM provider_info_cache`).Scan(&count)
	return count == 0, err
}
