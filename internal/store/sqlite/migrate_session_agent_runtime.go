package sqlite

import "fmt"

// migrateSessionAgentRuntime adds the per-session agent runtime columns to old
// databases. New databases already have the columns from schema.sql.
func (d *DB) migrateSessionAgentRuntime() error {
	var hasAgentKind bool
	row := d.db.QueryRow(`SELECT COUNT(*) > 0 FROM pragma_table_info('ingest_sessions') WHERE name = 'agent_kind'`)
	if err := row.Scan(&hasAgentKind); err != nil {
		return fmt.Errorf("check agent_kind column: %w", err)
	}
	if hasAgentKind {
		return nil
	}
	if _, err := d.db.Exec(`ALTER TABLE ingest_sessions ADD COLUMN agent_kind TEXT NOT NULL DEFAULT 'native' CHECK(agent_kind IN ('native','acp'))`); err != nil {
		return fmt.Errorf("add agent_kind column: %w", err)
	}
	if _, err := d.db.Exec(`ALTER TABLE ingest_sessions ADD COLUMN acp_agent_id TEXT NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("add acp_agent_id column: %w", err)
	}
	return nil
}
