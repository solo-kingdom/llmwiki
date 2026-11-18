package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
)

const databaseURLEnv = "LLMWIKI_DATABASE_URL"

// databaseURL is bound to the root --database-url flag.
var databaseURL string

func resolveDatabaseURL() (string, error) {
	if databaseURL != "" {
		return databaseURL, nil
	}
	if v := os.Getenv(databaseURLEnv); v != "" {
		return v, nil
	}
	return "", fmt.Errorf("database URL is required: pass --database-url or set %s", databaseURLEnv)
}

func openDatabase() (*postgres.DB, error) {
	dsn, err := resolveDatabaseURL()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return postgres.Open(ctx, dsn)
}
