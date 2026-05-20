package sqlite

import "testing"

func TestInsertAndTrimIngestJobEvents(t *testing.T) {
	db := helperDB(t)
	job := &IngestJob{InputType: "text", SourcePath: "raw/sources/a.md", Status: "queued"}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 5; i++ {
		if err := db.InsertIngestJobEvent(job.ID, "analysis", "request", "msg", map[string]any{"i": i}, 3); err != nil {
			t.Fatal(err)
		}
	}

	events, err := db.ListIngestJobEvents(job.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("len(events) = %d, want 3", len(events))
	}
	if events[0].Step != "analysis" || events[2].Phase != "request" {
		t.Fatalf("unexpected event order: %+v", events)
	}
}

func TestRecoverStaleRunningJobsClearsErrors(t *testing.T) {
	db := helperDB(t)
	job := &IngestJob{
		InputType:    "text",
		SourcePath:   "raw/sources/b.md",
		Status:       "running",
		ErrorCode:    "pipeline_error",
		ErrorMessage: "boom",
		HeartbeatAt:  "2000-01-01 00:00:00",
		RunnerID:     "old-runner",
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatal(err)
	}
	_, err := db.db.Exec(`UPDATE ingest_jobs SET status='running', error_code='pipeline_error', error_message='boom', heartbeat_at='2000-01-01 00:00:00', runner_id='old' WHERE id=?`, job.ID)
	if err != nil {
		t.Fatal(err)
	}

	ids, err := db.RecoverStaleRunningJobs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 {
		t.Fatalf("recovered = %d, want 1", len(ids))
	}

	got, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "queued" {
		t.Fatalf("status = %q, want queued", got.Status)
	}
	if got.ErrorCode != "" || got.ErrorMessage != "" {
		t.Fatalf("errors not cleared: code=%q msg=%q", got.ErrorCode, got.ErrorMessage)
	}
}

func TestClaimNextIngestJobSerial(t *testing.T) {
	db := helperDB(t)
	for i := 0; i < 2; i++ {
		j := &IngestJob{InputType: "text", SourcePath: "raw/sources/x.md", Status: "queued"}
		if err := db.CreateIngestJob(j); err != nil {
			t.Fatal(err)
		}
	}

	first, err := db.ClaimNextIngestJob("runner-a")
	if err != nil || first == nil {
		t.Fatalf("first claim: job=%v err=%v", first, err)
	}
	second, err := db.ClaimNextIngestJob("runner-b")
	if err != nil {
		t.Fatal(err)
	}
	if second != nil {
		t.Fatal("expected no second claim while first running")
	}

	_, _ = db.db.Exec(`UPDATE ingest_jobs SET status='succeeded', runner_id='', heartbeat_at='' WHERE id=?`, first.ID)

	third, err := db.ClaimNextIngestJob("runner-b")
	if err != nil || third == nil {
		t.Fatalf("third claim: job=%v err=%v", third, err)
	}
}

func TestParseJobEventsMaxCount(t *testing.T) {
	n, err := ParseJobEventsMaxCount("200")
	if err != nil || n != 200 {
		t.Fatalf("got %d err=%v", n, err)
	}
	if _, err := ParseJobEventsMaxCount("10"); err == nil {
		t.Fatal("expected error for out of range")
	}
}
