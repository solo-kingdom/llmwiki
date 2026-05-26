package sqlite

func (d *DB) migrateSessionMessageEvents() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS session_message_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id TEXT NOT NULL REFERENCES ingest_session_messages(id) ON DELETE CASCADE,
			step TEXT NOT NULL,
			phase TEXT NOT NULL,
			message TEXT NOT NULL DEFAULT '',
			payload TEXT NOT NULL DEFAULT '',
			created_at TEXT DEFAULT (datetime('now'))
		);
		CREATE INDEX IF NOT EXISTS idx_session_msg_events
			ON session_message_events(message_id, id DESC);
	`)
	return err
}
