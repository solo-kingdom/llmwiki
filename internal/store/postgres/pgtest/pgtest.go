// Package pgtest creates isolated PostgreSQL schemas for tests.
package pgtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"

	postgres "github.com/solo-kingdom/llmwiki/internal/store/postgres"
)

// TB is the subset of testing.TB used here, keeping this package test-agnostic.
type TB interface {
	Helper()
	Fatalf(format string, args ...any)
	Cleanup(func())
}

var seq atomic.Int64

// Open returns a store backed by a fresh schema and drops the schema on cleanup.
// It fails the test when LLMWIKI_TEST_DATABASE_URL is not set.
func Open(tb TB) *postgres.DB {
	tb.Helper()
	base := os.Getenv("LLMWIKI_TEST_DATABASE_URL")
	if base == "" {
		tb.Fatalf("LLMWIKI_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	schema := testSchemaName()

	conn, err := pgx.Connect(ctx, base)
	if err != nil {
		tb.Fatalf("connect postgres: %v", err)
	}
	if _, err := conn.Exec(ctx, "CREATE SCHEMA "+quoteIdent(schema)); err != nil {
		_ = conn.Close(ctx)
		tb.Fatalf("create schema: %v", err)
	}
	_ = conn.Close(ctx)

	db, err := postgres.Open(ctx, withSearchPath(base, schema))
	if err != nil {
		tb.Fatalf("open store: %v", err)
	}
	tb.Cleanup(func() {
		_ = db.Close()
		c, err := pgx.Connect(context.Background(), base)
		if err == nil {
			_, _ = c.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+quoteIdent(schema)+" CASCADE")
			_ = c.Close(context.Background())
		}
	})
	return db
}

func testSchemaName() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("llmwiki_test_%d_%d_%s", time.Now().UnixNano(), seq.Add(1), hex.EncodeToString(b[:]))
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func withSearchPath(dsn, schema string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return dsn
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String()
}
