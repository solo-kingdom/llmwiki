package sqlite

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestIngestSessionAgentRuntimeColumns(t *testing.T) {
	db := helperDB(t)

	columns := map[string]bool{}
	rows, err := db.DB().Query(`SELECT name FROM pragma_table_info('ingest_sessions')`)
	if err != nil {
		t.Fatalf("pragma_table_info: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan column: %v", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("columns rows: %v", err)
	}
	if !columns["agent_kind"] || !columns["acp_agent_id"] {
		t.Fatalf("missing agent runtime columns: %#v", columns)
	}
}

func TestMigrateSessionAgentRuntimeOldDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	legacy, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	_, err = legacy.Exec(`
		CREATE TABLE ingest_sessions (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active',
			storage_path TEXT NOT NULL DEFAULT '',
			llm_instance_id TEXT NOT NULL DEFAULT '',
			llm_model TEXT NOT NULL DEFAULT '',
			mode TEXT NOT NULL DEFAULT 'ingest',
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now'))
		);
		INSERT INTO ingest_sessions (id, title) VALUES ('legacy', 'legacy session');
	`)
	if err != nil {
		legacy.Close()
		t.Fatalf("create legacy table: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open legacy db: %v", err)
	}
	defer db.Close()

	session, err := db.GetIngestSession("legacy")
	if err != nil {
		t.Fatalf("GetIngestSession: %v", err)
	}
	if session == nil {
		t.Fatal("legacy session not found")
	}
	if session.AgentKind != "native" || session.ACPAgentID != "" {
		t.Fatalf("legacy runtime = (%q, %q), want (native, '')", session.AgentKind, session.ACPAgentID)
	}
	if err := db.migrateSessionAgentRuntime(); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
}

func TestUpdateIngestSessionAgentRoundTrip(t *testing.T) {
	db := helperDB(t)
	session := &IngestSession{Title: "agent runtime"}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	if session.AgentKind != "native" {
		t.Fatalf("new session agent_kind = %q, want native", session.AgentKind)
	}

	if err := db.UpdateIngestSessionAgent(session.ID, "acp", "agent-a"); err != nil {
		t.Fatalf("UpdateIngestSessionAgent: %v", err)
	}
	got, err := db.GetIngestSession(session.ID)
	if err != nil {
		t.Fatalf("GetIngestSession: %v", err)
	}
	if got.AgentKind != "acp" || got.ACPAgentID != "agent-a" {
		t.Fatalf("runtime = (%q, %q), want (acp, agent-a)", got.AgentKind, got.ACPAgentID)
	}
}

func TestIngestSessionAgentKindCheck(t *testing.T) {
	db := helperDB(t)
	session := &IngestSession{Title: "invalid", AgentKind: "bogus"}
	if err := db.CreateIngestSession(session); err == nil {
		t.Fatal("CreateIngestSession accepted invalid agent_kind")
	}
}
