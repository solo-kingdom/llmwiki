package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
)

// setupTestDatabase creates an isolated schema in LLMWIKI_TEST_DATABASE_URL and
// returns a DSN that scopes connections to it. The schema is dropped on cleanup.
func setupTestDatabase(t *testing.T) string {
	t.Helper()
	base := os.Getenv("LLMWIKI_TEST_DATABASE_URL")
	if base == "" {
		t.Fatalf("LLMWIKI_TEST_DATABASE_URL is not set")
	}

	schema := fmt.Sprintf("llmwiki_cmd_test_%d", time.Now().UnixNano())
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	if _, err := conn.Exec(ctx, `CREATE SCHEMA "`+schema+`"`); err != nil {
		_ = conn.Close(ctx)
		t.Fatalf("create schema: %v", err)
	}
	_ = conn.Close(ctx)
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), base)
		if err != nil {
			return
		}
		_, _ = c.Exec(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		_ = c.Close(context.Background())
	})

	u, err := url.Parse(base)
	if err != nil {
		t.Fatalf("parse database url: %v", err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String()
}

// initTestDB returns a DSN scoped to a fresh schema and points runInit at it.
func initTestDB(t *testing.T) string {
	t.Helper()
	dsn := setupTestDatabase(t)
	t.Setenv("LLMWIKI_DATABASE_URL", dsn)
	return dsn
}

func TestInitCreatesFullDirectoryStructure(t *testing.T) {
	initTestDB(t)
	ws := t.TempDir()
	if err := runInit(ws, ""); err != nil {
		t.Fatalf("runInit: %v", err)
	}

	for _, d := range engine.WorkspaceDirs {
		info, err := os.Stat(filepath.Join(ws, d))
		if err != nil {
			t.Errorf("missing directory %s: %v", d, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("%s is not a directory", d)
		}
	}
}

func TestInitScaffoldLanguageChinese(t *testing.T) {
	initTestDB(t)
	ws := t.TempDir()
	if err := runInit(ws, ""); err != nil {
		t.Fatalf("runInit: %v", err)
	}

	purpose, err := os.ReadFile(filepath.Join(ws, "purpose.md"))
	if err != nil {
		t.Fatalf("ReadFile purpose.md: %v", err)
	}
	if !strings.Contains(string(purpose), "研究目标") {
		t.Errorf("purpose.md not in Chinese: %s", purpose)
	}
	if !strings.Contains(string(purpose), "key_questions") {
		t.Error("purpose.md missing key_questions YAML field")
	}

	logData, err := os.ReadFile(filepath.Join(ws, "wiki", "log.md"))
	if err != nil {
		t.Fatalf("ReadFile log.md: %v", err)
	}
	if !strings.Contains(string(logData), "工作区初始化") {
		t.Errorf("log.md missing init entry: %s", logData)
	}

	indexData, err := os.ReadFile(filepath.Join(ws, "wiki", "index.md"))
	if err != nil {
		t.Fatalf("ReadFile index.md: %v", err)
	}
	if !strings.Contains(string(indexData), "内容目录") {
		t.Errorf("index.md not in Chinese: %s", indexData)
	}
}

func TestInitDoesNotOverwriteExistingScaffold(t *testing.T) {
	ws := t.TempDir()
	if err := engine.EnsureWorkspaceStructure(ws); err != nil {
		t.Fatalf("EnsureWorkspaceStructure: %v", err)
	}
	custom := "用户自定义内容"
	path := filepath.Join(ws, "purpose.md")
	if err := os.WriteFile(path, []byte(custom), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	if err := engine.WriteWorkspaceScaffoldsIfMissing(ws, "2024-01-01"); err != nil {
		t.Fatalf("WriteWorkspaceScaffoldsIfMissing: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != custom {
		t.Errorf("purpose.md overwritten: got %q", data)
	}
}

func TestInitRepairModePreservesWorkspace(t *testing.T) {
	dsn := initTestDB(t)
	ws := t.TempDir()

	if err := runInit(ws, ""); err != nil {
		t.Fatalf("first runInit: %v", err)
	}

	db, err := postgres.Open(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer db.Close()

	before, err := db.GetWorkspace()
	if err != nil {
		t.Fatalf("GetWorkspace before repair: %v", err)
	}
	if before == nil {
		t.Fatal("expected workspace row after init")
	}

	// Remove a directory and scaffold to simulate partial workspace
	if err := os.RemoveAll(filepath.Join(ws, "wiki", "synthesis")); err != nil {
		t.Fatalf("RemoveAll synthesis: %v", err)
	}
	if err := os.Remove(filepath.Join(ws, ".obsidian", "app.json")); err != nil {
		t.Fatalf("Remove app.json: %v", err)
	}
	if err := os.RemoveAll(filepath.Join(ws, "wiki", "templates")); err != nil {
		t.Fatalf("RemoveAll templates: %v", err)
	}

	if err := runInit(ws, ""); err != nil {
		t.Fatalf("second runInit (repair): %v", err)
	}

	if _, err := os.Stat(filepath.Join(ws, "wiki", "synthesis")); err != nil {
		t.Errorf("repair should recreate wiki/synthesis: %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, ".obsidian", "app.json")); err != nil {
		t.Errorf("repair should recreate Obsidian config: %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, "wiki", "templates", "entity.md")); err != nil {
		t.Errorf("repair should recreate wiki/templates: %v", err)
	}

	after, err := db.GetWorkspace()
	if err != nil {
		t.Fatalf("GetWorkspace after repair: %v", err)
	}
	if after == nil || after.ID != before.ID {
		t.Errorf("repair should preserve the workspace row: before=%+v after=%+v", before, after)
	}
	if doc, err := db.GetDocumentByPath("index.md", "/wiki/"); err != nil {
		t.Fatalf("GetDocumentByPath: %v", err)
	} else if doc == nil {
		t.Error("repair should preserve the indexed wiki index")
	}
}

func TestInitCreatesWikiPageTemplates(t *testing.T) {
	initTestDB(t)
	ws := t.TempDir()
	if err := runInit(ws, ""); err != nil {
		t.Fatalf("runInit: %v", err)
	}

	templatesDir := filepath.Join(ws, "wiki", "templates")
	info, err := os.Stat(templatesDir)
	if err != nil {
		t.Fatalf("missing wiki/templates: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("wiki/templates is not a directory")
	}

	for _, name := range []string{"entity.md", "concept.md", "source.md", "synthesis.md", "comparison.md", "query.md"} {
		path := filepath.Join(templatesDir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("missing template %s: %v", name, err)
		}
		if !strings.Contains(string(data), "Required Sections") {
			t.Errorf("%s missing Required Sections comment", name)
		}
	}
}

func TestInitCreatesObsidianConfig(t *testing.T) {
	initTestDB(t)
	ws := t.TempDir()
	if err := runInit(ws, ""); err != nil {
		t.Fatalf("runInit: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(ws, ".obsidian", "app.json"))
	if err != nil {
		t.Fatalf("ReadFile app.json: %v", err)
	}
	if !strings.Contains(string(data), "useMarkdownLinks") {
		t.Errorf("unexpected app.json: %s", data)
	}
}

func TestInitRegistersWorkspaceAndIndexesWikiIndex(t *testing.T) {
	dsn := initTestDB(t)
	ws := t.TempDir()
	if err := runInit(ws, ""); err != nil {
		t.Fatalf("runInit: %v", err)
	}

	db, err := postgres.Open(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer db.Close()

	workspace, err := db.GetWorkspace()
	if err != nil {
		t.Fatalf("GetWorkspace: %v", err)
	}
	if workspace == nil {
		t.Fatal("expected workspace row after init")
	}
	if workspace.Name != filepath.Base(ws) {
		t.Errorf("workspace name = %q, want %q", workspace.Name, filepath.Base(ws))
	}

	doc, err := db.GetDocumentByPath("index.md", "/wiki/")
	if err != nil {
		t.Fatalf("GetDocumentByPath: %v", err)
	}
	if doc == nil {
		t.Fatal("expected wiki/index.md in database after init")
	}
}
