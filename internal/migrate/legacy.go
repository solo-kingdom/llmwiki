// Package migrate imports a legacy SQLite + files workspace into PostgreSQL.
package migrate

import (
	"database/sql"
	"fmt"
	"os"

	_ "modernc.org/sqlite"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// LegacyData is the subset of the old SQLite index that is not rebuildable from files.
type LegacyData struct {
	Config        map[string]string
	Providers     []store.ProviderInstance
	DocumentCount int
}

// ReadLegacy loads settings, provider instances and document count from the
// SQLite index. A missing database yields an empty result without error.
func ReadLegacy(dbPath string) (*LegacyData, error) {
	out := &LegacyData{Config: map[string]string{}}
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, err
	}
	db, err := sql.Open("sqlite", dbPath+"?_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open legacy sqlite: %w", err)
	}
	defer db.Close()

	if rows, err := db.Query(`SELECT key, value FROM app_config`); err == nil {
		for rows.Next() {
			var k, v string
			if err := rows.Scan(&k, &v); err != nil {
				rows.Close()
				return nil, err
			}
			out.Config[k] = v
		}
		rows.Close()
	}

	if rows, err := db.Query(`SELECT id, name, catalog_id, api_key, base_url FROM provider_instances`); err == nil {
		for rows.Next() {
			var p store.ProviderInstance
			if err := rows.Scan(&p.ID, &p.Name, &p.CatalogID, &p.APIKey, &p.BaseURL); err != nil {
				rows.Close()
				return nil, err
			}
			out.Providers = append(out.Providers, p)
		}
		rows.Close()
	}

	if err := db.QueryRow(`SELECT COUNT(*) FROM documents`).Scan(&out.DocumentCount); err != nil {
		// Older databases always have the table; ignore counts we cannot read.
		out.DocumentCount = 0
	}
	return out, nil
}
