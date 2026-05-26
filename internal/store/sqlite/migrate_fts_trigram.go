package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
)

const ftsTrigramDDL = `
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content,
    content='document_chunks',
    content_rowid='rowid',
    tokenize='trigram'
);

CREATE TRIGGER chunks_fts_insert AFTER INSERT ON document_chunks BEGIN
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER chunks_fts_delete AFTER DELETE ON document_chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER chunks_fts_update AFTER UPDATE ON document_chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`

func (d *DB) migrateFTSTrigram() error {
	var createSQL sql.NullString
	err := d.db.QueryRow(
		`SELECT sql FROM sqlite_master WHERE type='table' AND name='chunks_fts'`,
	).Scan(&createSQL)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read chunks_fts schema: %w", err)
	}
	if createSQL.Valid && strings.Contains(createSQL.String, "tokenize='trigram'") {
		return nil
	}

	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, trigger := range []string{"chunks_fts_insert", "chunks_fts_delete", "chunks_fts_update"} {
		if _, err := tx.Exec("DROP TRIGGER IF EXISTS " + trigger); err != nil {
			return fmt.Errorf("drop trigger %s: %w", trigger, err)
		}
	}
	if _, err := tx.Exec("DROP TABLE IF EXISTS chunks_fts"); err != nil {
		return fmt.Errorf("drop chunks_fts: %w", err)
	}
	if _, err := tx.Exec(ftsTrigramDDL); err != nil {
		return fmt.Errorf("create trigram chunks_fts: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')`); err != nil {
		return fmt.Errorf("rebuild chunks_fts: %w", err)
	}

	return tx.Commit()
}
