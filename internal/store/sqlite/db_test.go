package sqlite

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// helperDB creates a temporary database for testing.
func helperDB(t *testing.T) *DB {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestOpen(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer db.Close()

	// Verify DB file was created
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("database file was not created")
	}

	// Verify underlying sql.DB is accessible
	if db.DB() == nil {
		t.Error("DB() returned nil")
	}
}

func TestOpenCreatesParentDir(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "nested", "deep", "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() with nested dirs error = %v", err)
	}
	defer db.Close()

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("database file was not created in nested dir")
	}
}

func TestOpenBusyTimeoutAndSingleConnection(t *testing.T) {
	db := helperDB(t)

	var busy int
	if err := db.DB().QueryRow("PRAGMA busy_timeout").Scan(&busy); err != nil {
		t.Fatalf("PRAGMA busy_timeout: %v", err)
	}
	if busy < 5000 {
		t.Errorf("busy_timeout = %d, want >= 5000", busy)
	}

	stats := db.DB().Stats()
	if stats.MaxOpenConnections != 1 {
		t.Errorf("MaxOpenConnections = %d, want 1", stats.MaxOpenConnections)
	}
}

func TestCreateIngestJobWaitsForOpenTransaction(t *testing.T) {
	db := helperDB(t)

	tx, err := db.DB().Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}

	// Hold the sole connection in a write transaction (simulates claim).
	if _, err := tx.Exec(`
		INSERT INTO ingest_jobs (input_type, source_path, status, retries, max_retries)
		VALUES ('text', 'raw/sources/hold.md', 'queued', 0, 3)`); err != nil {
		t.Fatalf("insert hold job: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		job := &IngestJob{
			InputType:  "session_archive",
			SourcePath: "raw/sources/web-ingest/sessions/s1/archive.md",
			SourceRef:  "session:s1",
			Status:     "queued",
		}
		done <- db.CreateIngestJob(job)
	}()

	time.Sleep(50 * time.Millisecond)
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit hold tx: %v", err)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("CreateIngestJob after tx release: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("CreateIngestJob timed out waiting for connection")
	}
}

func TestClose(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}

	if err := db.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}

func TestMigrate(t *testing.T) {
	db := helperDB(t)

	// Tables should exist after migration
	tables := []string{"workspace", "documents", "document_pages", "document_chunks", "document_references"}
	for _, table := range tables {
		var name string
		err := db.DB().QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found after migration: %v", table, err)
		}
	}

	// Verify FTS5 virtual table exists
	var vtableName string
	err := db.DB().QueryRow(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'",
	).Scan(&vtableName)
	if err != nil {
		t.Errorf("chunks_fts virtual table not found: %v", err)
	}

	// Verify triggers exist
	triggers := []string{"chunks_fts_insert", "chunks_fts_delete", "chunks_fts_update"}
	for _, trigger := range triggers {
		var name string
		err := db.DB().QueryRow(
			"SELECT name FROM sqlite_master WHERE type='trigger' AND name=?", trigger,
		).Scan(&name)
		if err != nil {
			t.Errorf("trigger %q not found after migration: %v", trigger, err)
		}
	}
}

func TestMigrateIdempotent(t *testing.T) {
	db := helperDB(t)

	// Running migration again should not error
	if err := db.Migrate(); err != nil {
		t.Fatalf("second Migrate() error = %v", err)
	}
}
