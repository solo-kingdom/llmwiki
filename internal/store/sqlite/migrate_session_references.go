package sqlite

func (d *DB) migrateSessionReferences() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS ingest_session_references (
			id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
			session_id TEXT NOT NULL REFERENCES ingest_sessions(id) ON DELETE CASCADE,
			document_id TEXT NOT NULL,
			relative_path TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL CHECK (source IN ('user_mention', 'tool_read')),
			first_seen_at TEXT DEFAULT (datetime('now')),
			UNIQUE(session_id, document_id)
		);
		CREATE INDEX IF NOT EXISTS idx_ingest_session_refs_session
			ON ingest_session_references(session_id, datetime(first_seen_at));
	`)
	if err != nil {
		return err
	}
	return d.addColumnIgnoreDuplicate("ingest_session_messages", "wiki_refs_json", "TEXT NOT NULL DEFAULT '[]'")
}
