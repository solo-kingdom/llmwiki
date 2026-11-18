package postgres_test

import (
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestAppConfigDefaultsAndUpsert(t *testing.T) {
	db := pgtest.Open(t)

	if got := db.MaxConcurrentJobs(); got != store.DefaultMaxConcurrentJobs {
		t.Fatalf("default MaxConcurrentJobs = %d, want %d", got, store.DefaultMaxConcurrentJobs)
	}
	if db.ParallelEnabled() {
		t.Fatal("ParallelEnabled should default to false")
	}

	v, err := db.GetConfig("does_not_exist")
	if err != nil {
		t.Fatalf("GetConfig missing key: %v", err)
	}
	if v != "" {
		t.Fatalf("GetConfig missing key = %q, want empty", v)
	}

	if err := db.SetConfig("job_max_concurrent", "5"); err != nil {
		t.Fatalf("SetConfig: %v", err)
	}
	if got := db.MaxConcurrentJobs(); got != 5 {
		t.Fatalf("MaxConcurrentJobs = %d, want 5", got)
	}

	// Second write must update the existing row rather than fail on the PK.
	if err := db.SetConfig("job_max_concurrent", "2"); err != nil {
		t.Fatalf("SetConfig upsert: %v", err)
	}
	if got := db.MaxConcurrentJobs(); got != 2 {
		t.Fatalf("MaxConcurrentJobs after upsert = %d, want 2", got)
	}

	for _, bad := range []string{"0", "-3", "abc", ""} {
		if err := db.SetConfig("job_max_concurrent", bad); err != nil {
			t.Fatalf("SetConfig(%q): %v", bad, err)
		}
		if got := db.MaxConcurrentJobs(); got != store.DefaultMaxConcurrentJobs {
			t.Fatalf("MaxConcurrentJobs with %q = %d, want default %d", bad, got, store.DefaultMaxConcurrentJobs)
		}
	}

	for _, on := range []string{"true", "1"} {
		if err := db.SetConfig("job_parallel_enabled", on); err != nil {
			t.Fatalf("SetConfig(%q): %v", on, err)
		}
		if !db.ParallelEnabled() {
			t.Fatalf("ParallelEnabled with %q = false, want true", on)
		}
	}
	if err := db.SetConfig("job_parallel_enabled", "false"); err != nil {
		t.Fatalf("SetConfig(false): %v", err)
	}
	if db.ParallelEnabled() {
		t.Fatal("ParallelEnabled with \"false\" = true, want false")
	}

	all, err := db.GetAllConfig()
	if err != nil {
		t.Fatalf("GetAllConfig: %v", err)
	}
	if got := all["job_max_concurrent"]; got != "" {
		t.Fatalf("GetAllConfig job_max_concurrent = %q, want last written empty", got)
	}
	if got := all["job_parallel_enabled"]; got != "false" {
		t.Fatalf("GetAllConfig job_parallel_enabled = %q, want false", got)
	}
}
