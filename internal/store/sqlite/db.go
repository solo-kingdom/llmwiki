// Package sqlite provides SQLite-backed store implementations.
package sqlite

import (
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// DB wraps the SQLite database connection with helper methods.
type DB struct {
	db *sql.DB
}

// Open opens or creates a SQLite database at the given path.
// It runs migrations on first open.
func Open(dbPath string) (*DB, error) {
	// Ensure parent directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	conn, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=10000")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	// SQLite allows one writer at a time; serialize through a single connection.
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)

	// Enable WAL mode and foreign keys
	if _, err := conn.Exec("PRAGMA journal_mode=WAL"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("enable WAL: %w", err)
	}
	if _, err := conn.Exec("PRAGMA foreign_keys=ON"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}
	if _, err := conn.Exec("PRAGMA busy_timeout=10000"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("enable busy timeout: %w", err)
	}

	d := &DB{db: conn}

	// Run migrations
	if err := d.Migrate(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return d, nil
}

// Close closes the database connection.
func (d *DB) Close() error {
	return d.db.Close()
}

// DB returns the underlying *sql.DB for use in low-level operations.
func (d *DB) DB() *sql.DB {
	return d.db
}

// Migrate runs the schema migration.
func (d *DB) Migrate() error {
	if _, err := d.db.Exec(schemaSQL); err != nil {
		return err
	}
	if err := d.migrateIngestQueue(); err != nil {
		return err
	}
	if err := d.migrateSessionReferences(); err != nil {
		return err
	}
	return d.migrateFTSTrigram()
}

// Ensure embed is used
var _ embed.FS
