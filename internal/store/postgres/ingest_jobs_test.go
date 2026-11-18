package postgres_test

import (
	"context"
	"sync"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

var (
	_ store.JobStore     = (*postgres.DB)(nil)
	_ store.SessionStore = (*postgres.DB)(nil)
	_ store.ReviewStore  = (*postgres.DB)(nil)
)

func setConfig(t *testing.T, db *postgres.DB, key, value string) {
	t.Helper()
	if _, err := db.Pool().Exec(context.Background(), `
		INSERT INTO app_config (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value); err != nil {
		t.Fatalf("set config %s: %v", key, err)
	}
}

func newJob(t *testing.T, db *postgres.DB, sourcePath string) *store.IngestJob {
	t.Helper()
	job := &store.IngestJob{InputType: "text", SourcePath: sourcePath, Status: "queued"}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}
	return job
}

func TestCreateAndGetIngestJob(t *testing.T) {
	db := pgtest.Open(t)

	job := newJob(t, db, "raw/sources/a.md")
	if job.ID == "" {
		t.Fatal("expected generated job ID")
	}
	if job.CreatedAt == "" || job.UpdatedAt == "" {
		t.Fatalf("expected timestamps, got created=%q updated=%q", job.CreatedAt, job.UpdatedAt)
	}

	got, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if got == nil || got.SourcePath != job.SourcePath || got.Status != "queued" {
		t.Fatalf("unexpected job: %+v", got)
	}

	missing, err := db.GetIngestJob("nope")
	if err != nil || missing != nil {
		t.Fatalf("missing job = %+v, err = %v", missing, err)
	}

	bad := &store.IngestJob{InputType: "text", SourcePath: "x", Status: "bogus"}
	if err := db.CreateIngestJob(bad); err == nil {
		t.Fatal("expected invalid status error")
	}
	if err := db.CreateIngestJob(&store.IngestJob{InputType: "text"}); err == nil {
		t.Fatal("expected source_path required error")
	}
}

func TestListAndLineageIngestJobs(t *testing.T) {
	db := pgtest.Open(t)

	root := newJob(t, db, "raw/sources/root.md")
	child := &store.IngestJob{InputType: "text", SourcePath: "raw/sources/child.md", ParentJobID: root.ID}
	if err := db.CreateIngestJob(child); err != nil {
		t.Fatalf("CreateIngestJob child: %v", err)
	}

	jobs, err := db.ListIngestJobs(10)
	if err != nil || len(jobs) != 2 {
		t.Fatalf("ListIngestJobs = %d jobs, err %v", len(jobs), err)
	}

	lineage, err := db.GetJobLineage(child.ID)
	if err != nil {
		t.Fatalf("GetJobLineage: %v", err)
	}
	if len(lineage) != 2 || lineage[0].ID != root.ID || lineage[1].ID != child.ID {
		t.Fatalf("unexpected lineage: %+v", lineage)
	}
}

func TestClaimNextIngestJobSerial(t *testing.T) {
	db := pgtest.Open(t)
	first := newJob(t, db, "raw/sources/x.md")
	second := newJob(t, db, "raw/sources/y.md")

	claimed, err := db.ClaimNextIngestJob("runner-a")
	if err != nil || claimed == nil {
		t.Fatalf("first claim: job=%v err=%v", claimed, err)
	}
	if claimed.Status != "running" || claimed.RunnerID != "runner-a" || claimed.HeartbeatAt == "" {
		t.Fatalf("unexpected claimed job: %+v", claimed)
	}

	// Serial mode (job_parallel_enabled unset) allows one running job.
	blocked, err := db.ClaimNextIngestJob("runner-b")
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if blocked != nil {
		t.Fatalf("expected no claim while a job is running, got %+v", blocked)
	}

	if err := db.UpdateIngestJobStatus(claimed.ID, "succeeded"); err != nil {
		t.Fatalf("UpdateIngestJobStatus: %v", err)
	}
	next, err := db.ClaimNextIngestJob("runner-b")
	if err != nil || next == nil {
		t.Fatalf("claim after finish: job=%v err=%v", next, err)
	}
	if next.ID != first.ID && next.ID != second.ID {
		t.Fatalf("claimed unknown job %s", next.ID)
	}
}

func TestClaimNextIngestJobParallelLimit(t *testing.T) {
	db := pgtest.Open(t)
	setConfig(t, db, "job_parallel_enabled", "true")
	setConfig(t, db, "job_max_concurrent", "2")
	for _, p := range []string{"a.md", "b.md", "c.md"} {
		newJob(t, db, "raw/sources/"+p)
	}

	for i := 0; i < 2; i++ {
		job, err := db.ClaimNextIngestJob("runner")
		if err != nil || job == nil {
			t.Fatalf("claim #%d: job=%v err=%v", i, job, err)
		}
	}
	third, err := db.ClaimNextIngestJob("runner")
	if err != nil || third != nil {
		t.Fatalf("third claim should respect limit, job=%v err=%v", third, err)
	}
}

func TestClaimNextIngestJobConcurrent(t *testing.T) {
	db := pgtest.Open(t)
	setConfig(t, db, "job_parallel_enabled", "true")
	setConfig(t, db, "job_max_concurrent", "3")
	for _, p := range []string{"a.md", "b.md", "c.md", "d.md", "e.md"} {
		newJob(t, db, "raw/sources/"+p)
	}

	const workers = 10
	ids := make(chan string, workers)
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			job, err := db.ClaimNextIngestJob("runner")
			if err != nil {
				errs <- err
				return
			}
			if job != nil {
				ids <- job.ID
			}
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent claim: %v", err)
	}
	claimed := map[string]bool{}
	for id := range ids {
		if claimed[id] {
			t.Fatalf("job %s claimed twice", id)
		}
		claimed[id] = true
	}
	if len(claimed) != 3 {
		t.Fatalf("claimed %d jobs, want 3 (concurrency limit)", len(claimed))
	}
}

func TestRecoverStaleRunningJobs(t *testing.T) {
	db := pgtest.Open(t)
	job := newJob(t, db, "raw/sources/stale.md")

	if _, err := db.Pool().Exec(context.Background(), `
		UPDATE ingest_jobs
		SET status = 'running', runner_id = 'old', error_code = 'pipeline_error',
			error_message = 'boom', heartbeat_at = '2000-01-01 00:00:00'
		WHERE id = $1`, job.ID); err != nil {
		t.Fatalf("seed stale job: %v", err)
	}

	ids, err := db.RecoverStaleRunningJobs()
	if err != nil {
		t.Fatalf("RecoverStaleRunningJobs: %v", err)
	}
	if len(ids) != 1 || ids[0] != job.ID {
		t.Fatalf("recovered ids = %v", ids)
	}

	got, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if got.Status != "queued" || got.RunnerID != "" || got.HeartbeatAt != "" {
		t.Fatalf("job not recovered: %+v", got)
	}
	if got.ErrorCode != "" || got.ErrorMessage != "" {
		t.Fatalf("errors not cleared: %+v", got)
	}
}

func TestFailureRetryAndCancel(t *testing.T) {
	db := pgtest.Open(t)
	job := newJob(t, db, "raw/sources/retry.md")

	if err := db.UpdateIngestJobFailure(job.ID, "missing_dependency", "pdftotext missing", "pdftotext", "install poppler"); err != nil {
		t.Fatalf("UpdateIngestJobFailure: %v", err)
	}
	failed, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if failed.Status != "failed" || failed.ErrorCode != "missing_dependency" || failed.Retries != 1 {
		t.Fatalf("unexpected failed job: %+v", failed)
	}

	retried, err := db.RetryIngestJob(job.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob: %v", err)
	}
	if retried == nil || retried.ID != job.ID || retried.Status != "queued" {
		t.Fatalf("unexpected retried job: %+v", retried)
	}
	if retried.ErrorCode != "" || retried.ErrorMessage != "" || retried.Remediation != "" || retried.ResultSummary != "" {
		t.Fatalf("error fields not cleared: %+v", retried)
	}

	if _, err := db.RetryIngestJob(job.ID); err == nil {
		t.Fatal("expected error retrying a queued job")
	}

	ok, err := db.CancelIngestJob(job.ID)
	if err != nil || !ok {
		t.Fatalf("CancelIngestJob ok=%v err=%v", ok, err)
	}
	got, _ := db.GetIngestJob(job.ID)
	if got.Status != "cancelled" {
		t.Fatalf("status = %q, want cancelled", got.Status)
	}
	ok, err = db.CancelIngestJob(job.ID)
	if err != nil || ok {
		t.Fatalf("second cancel ok=%v err=%v, want false", ok, err)
	}
}

func TestIngestJobEventsTrimAndRetention(t *testing.T) {
	db := pgtest.Open(t)
	job := newJob(t, db, "raw/sources/events.md")

	for i := 0; i < 5; i++ {
		if err := db.InsertIngestJobEvent(job.ID, "analysis", "request", "msg", map[string]any{"i": i}, 3); err != nil {
			t.Fatalf("InsertIngestJobEvent #%d: %v", i, err)
		}
	}
	events, err := db.ListIngestJobEvents(job.ID, 10)
	if err != nil {
		t.Fatalf("ListIngestJobEvents: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("len(events) = %d, want 3", len(events))
	}
	if events[0].Payload == "" || events[2].Phase != "request" {
		t.Fatalf("unexpected events: %+v", events)
	}

	if err := db.TrimIngestJobEvents(job.ID, 1); err != nil {
		t.Fatalf("TrimIngestJobEvents: %v", err)
	}
	events, _ = db.ListIngestJobEvents(job.ID, 10)
	if len(events) != 1 {
		t.Fatalf("after trim len = %d, want 1", len(events))
	}

	if got := db.GetJobEventsMaxCount(); got != store.DefaultJobEventsMaxCount {
		t.Fatalf("default max = %d, want %d", got, store.DefaultJobEventsMaxCount)
	}
	setConfig(t, db, "ingest_job_events_max_count", "500")
	if got := db.GetJobEventsMaxCount(); got != 500 {
		t.Fatalf("configured max = %d, want 500", got)
	}
	setConfig(t, db, "ingest_job_events_max_count", "10")
	if got := db.GetJobEventsMaxCount(); got != store.MinJobEventsMaxCount {
		t.Fatalf("clamped min = %d, want %d", got, store.MinJobEventsMaxCount)
	}
	setConfig(t, db, "ingest_job_events_max_count", "99999")
	if got := db.GetJobEventsMaxCount(); got != store.MaxJobEventsMaxCount {
		t.Fatalf("clamped max = %d, want %d", got, store.MaxJobEventsMaxCount)
	}
}
