package sqlite

import "testing"

func TestCreateAndGetIngestJob(t *testing.T) {
	db := helperDB(t)

	job := &IngestJob{
		InputType:  "text",
		SourcePath: "raw/sources/web-ingest/a.md",
		SourceRef:  "text",
		Status:     "queued",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob() error = %v", err)
	}
	if job.ID == "" {
		t.Fatal("expected non-empty job ID")
	}

	got, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob() error = %v", err)
	}
	if got == nil {
		t.Fatal("expected job, got nil")
	}
	if got.SourcePath != job.SourcePath {
		t.Errorf("SourcePath = %q, want %q", got.SourcePath, job.SourcePath)
	}
	if got.Status != "queued" {
		t.Errorf("Status = %q, want queued", got.Status)
	}
}

func TestListIngestJobs(t *testing.T) {
	db := helperDB(t)
	for i := 0; i < 3; i++ {
		job := &IngestJob{
			InputType:  "upload",
			SourcePath: "raw/sources/web-ingest/file.md",
			Status:     "queued",
		}
		if err := db.CreateIngestJob(job); err != nil {
			t.Fatalf("CreateIngestJob() #%d error = %v", i, err)
		}
	}

	jobs, err := db.ListIngestJobs(10)
	if err != nil {
		t.Fatalf("ListIngestJobs() error = %v", err)
	}
	if len(jobs) != 3 {
		t.Fatalf("len(jobs) = %d, want 3", len(jobs))
	}
}

func TestUpdateIngestJobFailureAndRetry(t *testing.T) {
	db := helperDB(t)
	job := &IngestJob{
		InputType:  "upload",
		SourcePath: "raw/sources/web-ingest/paper.pdf",
		Status:     "queued",
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob() error = %v", err)
	}

	if err := db.UpdateIngestJobFailure(job.ID, "missing_dependency", "pdftotext missing", "pdftotext", "install poppler-utils"); err != nil {
		t.Fatalf("UpdateIngestJobFailure() error = %v", err)
	}

	failed, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob() error = %v", err)
	}
	if failed.Status != "failed" {
		t.Fatalf("status = %q, want failed", failed.Status)
	}
	if failed.ErrorCode != "missing_dependency" {
		t.Fatalf("error_code = %q, want missing_dependency", failed.ErrorCode)
	}

	retry, err := db.RetryIngestJob(job.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob() error = %v", err)
	}
	if retry == nil {
		t.Fatal("expected retry job, got nil")
	}
	if retry.ParentJobID != job.ID {
		t.Fatalf("parent_job_id = %q, want %q", retry.ParentJobID, job.ID)
	}
	if retry.Status != "queued" {
		t.Fatalf("retry status = %q, want queued", retry.Status)
	}
}

func TestCancelIngestJob(t *testing.T) {
	db := helperDB(t)
	job := &IngestJob{
		InputType:  "text",
		SourcePath: "raw/sources/web-ingest/cancel.md",
		Status:     "queued",
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob() error = %v", err)
	}

	ok, err := db.CancelIngestJob(job.ID)
	if err != nil {
		t.Fatalf("CancelIngestJob() error = %v", err)
	}
	if !ok {
		t.Fatal("expected cancel ok=true")
	}

	got, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob() error = %v", err)
	}
	if got.Status != "cancelled" {
		t.Fatalf("status = %q, want cancelled", got.Status)
	}
}
