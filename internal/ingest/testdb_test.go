package ingest

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

// openTestDB returns a store backed by a fresh PostgreSQL schema that is
// dropped when the test finishes. LLMWIKI_TEST_DATABASE_URL must be set.
func openTestDB(t *testing.T) *postgres.DB {
	t.Helper()
	return pgtest.Open(t)
}
