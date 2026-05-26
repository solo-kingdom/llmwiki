package sqlite

import (
	"path/filepath"
	"testing"
)

func TestIngestReviewStateTransitions(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	r := &IngestReview{
		ArchiveSourcePath: "raw/sources/test.md",
		Status:            "planning",
	}
	if err := db.CreateIngestReview(r); err != nil {
		t.Fatal(err)
	}

	if err := db.UpdateIngestReviewStatus(r.ID, "ready_for_review"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateIngestReviewStatus(r.ID, "approved"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateIngestReviewStatus(r.ID, "applying"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateIngestReviewStatus(r.ID, "succeeded"); err != nil {
		t.Fatal(err)
	}

	r2 := &IngestReview{ArchiveSourcePath: "raw/x.md", Status: "planning"}
	if err := db.CreateIngestReview(r2); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateIngestReviewStatus(r2.ID, "bogus"); err == nil {
		t.Fatal("expected invalid status error")
	}
	if err := db.UpdateIngestReviewStatus(r2.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	if err := db.UpdateIngestReviewStatus(r2.ID, "revising"); err != nil {
		t.Fatal(err)
	}
}

func TestGetLatestIngestReviewBySessionID(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	r1 := &IngestReview{
		SessionID:         "sess-a",
		ArchiveSourcePath: "raw/a.md",
		Status:            "planning",
	}
	if err := db.CreateIngestReview(r1); err != nil {
		t.Fatal(err)
	}
	r2 := &IngestReview{
		SessionID:         "sess-a",
		ArchiveSourcePath: "raw/b.md",
		Status:            "planning",
	}
	if err := db.CreateIngestReview(r2); err != nil {
		t.Fatal(err)
	}

	latest, err := db.GetLatestIngestReviewBySessionID("sess-a")
	if err != nil {
		t.Fatal(err)
	}
	if latest == nil || latest.ID != r2.ID {
		t.Fatalf("latest = %+v, want id %s", latest, r2.ID)
	}
	n, err := db.CountIngestReviewsBySessionID("sess-a")
	if err != nil || n != 2 {
		t.Fatalf("count = %d, err %v", n, err)
	}
}

func TestIngestReviewPlanVersionIncrement(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	r := &IngestReview{ArchiveSourcePath: "raw/a.md", Status: "planning"}
	if err := db.CreateIngestReview(r); err != nil {
		t.Fatal(err)
	}
	v1, err := db.NextIngestReviewPlanVersion(r.ID)
	if err != nil || v1 != 1 {
		t.Fatalf("next version = %d, err %v", v1, err)
	}
	if err := db.CreateIngestReviewPlan(&IngestReviewPlan{
		ReviewID: r.ID, Version: v1, PlanMarkdown: "# Plan", PlanJSON: `{}`,
	}); err != nil {
		t.Fatal(err)
	}
	v2, err := db.NextIngestReviewPlanVersion(r.ID)
	if err != nil || v2 != 2 {
		t.Fatalf("next version = %d, want 2", v2)
	}
}
