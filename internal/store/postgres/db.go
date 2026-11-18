// Package postgres implements the store contract on PostgreSQL 16+ with pgvector.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

var _ store.Store = (*DB)(nil)

// DB is the PostgreSQL-backed store.
type DB struct {
	pool *pgxpool.Pool
}

// Open connects, verifies connectivity and applies pending migrations.
func Open(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour
	cfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	db := &DB{pool: pool}
	if err := db.Migrate(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return db, nil
}

// Pool exposes the underlying pool for tests and migration tooling.
func (d *DB) Pool() *pgxpool.Pool { return d.pool }

// Close releases all pooled connections.
func (d *DB) Close() error {
	if d.pool != nil {
		d.pool.Close()
	}
	return nil
}

// Migrate applies missing schema versions in order.
func (d *DB) Migrate(ctx context.Context) error {
	if _, err := d.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT (`+nowText+`)
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	var current int
	if err := d.pool.QueryRow(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	for _, m := range migrations {
		if m.Version <= current {
			continue
		}
		tx, err := d.pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", m.Version, err)
		}
		for _, stmt := range m.Statements {
			if _, err := tx.Exec(ctx, stmt); err != nil {
				if strings.HasPrefix(strings.TrimSpace(stmt), "CREATE EXTENSION") && isConcurrentExtensionErr(err) {
					continue
				}
				_ = tx.Rollback(ctx)
				return fmt.Errorf("migration %d: %w", m.Version, err)
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, m.Version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %d: %w", m.Version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.Version, err)
		}
	}
	return nil
}

// withTx runs fn inside a transaction and commits on success.
func (d *DB) withTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// lockWorkspace serializes apply-phase writes for this workspace.
func lockWorkspace(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('llmwiki:workspace'))`)
	return err
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// isConcurrentExtensionErr tolerates two processes creating the same extension at once.
func isConcurrentExtensionErr(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "already exists") || strings.Contains(msg, "duplicate key value")
}
