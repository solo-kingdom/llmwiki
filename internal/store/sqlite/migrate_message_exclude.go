package sqlite

func (d *DB) migrateMessageExclude() error {
	return d.addColumnIgnoreDuplicate("ingest_session_messages", "exclude_from_archive", "INTEGER NOT NULL DEFAULT 0")
}
