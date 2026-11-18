package postgres

import (
	"context"
	"fmt"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

// GetWorkspace returns the workspace row. Returns nil, nil when nothing is stored,
// matching the other Get* methods in this package.
func (d *DB) GetWorkspace() (*store.Workspace, error) {
	ws := &store.Workspace{}
	err := d.pool.QueryRow(context.Background(), `
		SELECT COALESCE(id,''), COALESCE(name,''), COALESCE(description,''),
		       COALESCE(user_id,''), COALESCE(created_at,'')
		FROM workspace ORDER BY created_at ASC, id ASC LIMIT 1`,
	).Scan(&ws.ID, &ws.Name, &ws.Description, &ws.UserID, &ws.CreatedAt)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return ws, nil
}

// UpsertWorkspace inserts the workspace row or updates the existing row for the
// same user_id, keeping the original id and created_at.
func (d *DB) UpsertWorkspace(ws *store.Workspace) error {
	if ws == nil {
		return fmt.Errorf("nil workspace")
	}
	err := d.pool.QueryRow(context.Background(), `
		INSERT INTO workspace (id, name, description, user_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description
		RETURNING id, created_at`,
		ws.ID, ws.Name, ws.Description, ws.UserID,
	).Scan(&ws.ID, &ws.CreatedAt)
	if err != nil {
		return fmt.Errorf("upsert workspace: %w", err)
	}
	return nil
}
