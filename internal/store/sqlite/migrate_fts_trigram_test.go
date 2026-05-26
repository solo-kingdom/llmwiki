package sqlite

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestTrigramTokenizerSupported(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')`); err != nil {
		t.Fatalf("modernc sqlite does not support trigram tokenizer: %v", err)
	}
}

func TestMigrateFTSTrigramFromPorter(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "porter.db")

	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	baseSchema := `
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    relative_path TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL DEFAULT 'wiki',
    file_type TEXT NOT NULL DEFAULT 'md',
    status TEXT NOT NULL DEFAULT 'ready',
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    page INTEGER,
    start_char INTEGER,
    token_count INTEGER,
    header_breadcrumb TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content,
    content='document_chunks',
    content_rowid='rowid',
    tokenize='porter unicode61'
);
CREATE TRIGGER chunks_fts_insert AFTER INSERT ON document_chunks BEGIN
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`
	if _, err := conn.Exec(baseSchema); err != nil {
		t.Fatalf("base schema: %v", err)
	}

	docID := "doc-1"
	if _, err := conn.Exec(`INSERT INTO documents (id, filename, title, path, relative_path) VALUES (?, 'cjk.md', 'cjk', '/wiki', 'wiki/cjk.md')`, docID); err != nil {
		t.Fatalf("insert doc: %v", err)
	}
	chunkContent := "这是一段中文测试文本，用于验证全文搜索功能"
	if _, err := conn.Exec(`INSERT INTO document_chunks (id, document_id, chunk_index, content, token_count) VALUES ('c1', ?, 0, ?, 10)`, docID, chunkContent); err != nil {
		t.Fatalf("insert chunk: %v", err)
	}
	conn.Close()

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open after porter schema: %v", err)
	}
	defer db.Close()

	var ftsSQL string
	if err := db.DB().QueryRow(`SELECT sql FROM sqlite_master WHERE name='chunks_fts'`).Scan(&ftsSQL); err != nil {
		t.Fatalf("read fts sql: %v", err)
	}
	if !strings.Contains(ftsSQL, "tokenize='trigram'") {
		t.Fatalf("expected trigram tokenizer after migration, got: %s", ftsSQL)
	}

	var ftsCount int
	if err := db.DB().QueryRow(`SELECT COUNT(*) FROM chunks_fts`).Scan(&ftsCount); err != nil {
		t.Fatalf("count fts: %v", err)
	}
	if ftsCount != 1 {
		t.Fatalf("expected 1 fts row after rebuild, got %d", ftsCount)
	}

	results, err := db.SearchChunks("中文测试", 10, "")
	if err != nil {
		t.Fatalf("SearchChunks: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected CJK FTS results after trigram migration")
	}
	if results[0].Score == 0 {
		t.Fatal("expected BM25-ranked FTS result (non-zero score), got LIKE fallback score 0")
	}
}
