package postgres_test

import (
	"context"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/store"
	"github.com/solo-kingdom/llmwiki/internal/store/postgres/pgtest"
)

func TestIngestReviewStateTransitions(t *testing.T) {
	db := pgtest.Open(t)

	r := &store.IngestReview{ArchiveSourcePath: "raw/sources/test.md", Status: "planning"}
	if err := db.CreateIngestReview(r); err != nil {
		t.Fatalf("CreateIngestReview: %v", err)
	}
	if r.ID == "" || r.CreatedAt == "" {
		t.Fatalf("unexpected created review: %+v", r)
	}

	for _, status := range []string{"ready_for_review", "revising", "ready_for_review", "approved", "applying", "succeeded"} {
		if err := db.UpdateIngestReviewStatus(r.ID, status); err != nil {
			t.Fatalf("transition to %s: %v", status, err)
		}
	}

	got, err := db.GetIngestReview(r.ID)
	if err != nil {
		t.Fatalf("GetIngestReview: %v", err)
	}
	if got.Status != "succeeded" {
		t.Fatalf("status = %q, want succeeded", got.Status)
	}

	err = db.UpdateIngestReviewStatus(r.ID, "planning")
	if err == nil || !strings.Contains(err.Error(), "invalid review status transition: succeeded -> planning") {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := db.UpdateIngestReviewStatus(r.ID, "bogus"); err == nil {
		t.Fatal("expected invalid status error")
	}
	if err := db.UpdateIngestReviewStatus("missing", "failed"); err == nil {
		t.Fatal("expected review not found error")
	}

	// failed can go back to revising.
	second := &store.IngestReview{ArchiveSourcePath: "raw/sources/second.md"}
	if err := db.CreateIngestReview(second); err != nil {
		t.Fatalf("CreateIngestReview second: %v", err)
	}
	if second.Status != "planning" {
		t.Fatalf("default status = %q, want planning", second.Status)
	}
	if err := db.UpdateIngestReviewStatus(second.ID, "failed"); err != nil {
		t.Fatalf("planning -> failed: %v", err)
	}
	if err := db.UpdateIngestReviewStatus(second.ID, "revising"); err != nil {
		t.Fatalf("failed -> revising: %v", err)
	}
	if err := db.UpdateIngestReviewStatus(second.ID, "cancelled"); err != nil {
		t.Fatalf("revising -> cancelled: %v", err)
	}

	if _, err := db.ListIngestReviews(10); err != nil {
		t.Fatalf("ListIngestReviews: %v", err)
	}
}

func TestIngestReviewPlanVersion(t *testing.T) {
	db := pgtest.Open(t)

	r := &store.IngestReview{ArchiveSourcePath: "raw/plan.md", Status: "planning"}
	if err := db.CreateIngestReview(r); err != nil {
		t.Fatalf("CreateIngestReview: %v", err)
	}

	v1, err := db.NextIngestReviewPlanVersion(r.ID)
	if err != nil || v1 != 1 {
		t.Fatalf("next version = %d, err %v", v1, err)
	}
	plan := &store.IngestReviewPlan{ReviewID: r.ID, Version: v1, PlanMarkdown: "# Plan", PlanJSON: `{"a":1}`}
	if err := db.CreateIngestReviewPlan(plan); err != nil {
		t.Fatalf("CreateIngestReviewPlan v1: %v", err)
	}
	if plan.ID == "" || plan.CreatedAt == "" {
		t.Fatalf("unexpected plan: %+v", plan)
	}

	v2, err := db.NextIngestReviewPlanVersion(r.ID)
	if err != nil || v2 != 2 {
		t.Fatalf("next version = %d, want 2", v2)
	}
	if err := db.CreateIngestReviewPlan(&store.IngestReviewPlan{ReviewID: r.ID, Version: v2, PlanMarkdown: "# Plan 2"}); err != nil {
		t.Fatalf("CreateIngestReviewPlan v2: %v", err)
	}

	plans, err := db.ListIngestReviewPlans(r.ID)
	if err != nil || len(plans) != 2 || plans[0].Version != 1 || plans[1].Version != 2 {
		t.Fatalf("plans = %+v, err %v", plans, err)
	}
	got, err := db.GetIngestReviewPlan(r.ID, 2)
	if err != nil || got == nil || got.PlanMarkdown != "# Plan 2" {
		t.Fatalf("GetIngestReviewPlan v2 = %+v, err %v", got, err)
	}
	if missing, err := db.GetIngestReviewPlan(r.ID, 99); err != nil || missing != nil {
		t.Fatalf("missing plan = %+v, err %v", missing, err)
	}

	if err := db.SetIngestReviewPlanVersion(r.ID, 2); err != nil {
		t.Fatalf("SetIngestReviewPlanVersion: %v", err)
	}
	if err := db.SetIngestReviewApprovedPlan(r.ID, 3); err == nil {
		t.Fatal("expected version exceeds current error")
	}
	if err := db.SetIngestReviewApprovedPlan(r.ID, 0); err == nil {
		t.Fatal("expected positive version error")
	}
	if err := db.SetIngestReviewApprovedPlan(r.ID, 2); err != nil {
		t.Fatalf("SetIngestReviewApprovedPlan: %v", err)
	}
	if err := db.SetIngestReviewFinalJob(r.ID, "job-1"); err != nil {
		t.Fatalf("SetIngestReviewFinalJob: %v", err)
	}
	if err := db.SetIngestReviewChangeSet(r.ID, "cs-1"); err != nil {
		t.Fatalf("SetIngestReviewChangeSet: %v", err)
	}

	gotReview, err := db.GetIngestReview(r.ID)
	if err != nil {
		t.Fatalf("GetIngestReview: %v", err)
	}
	if gotReview.CurrentPlanVersion != 2 || gotReview.ApprovedPlanVersion != 2 ||
		gotReview.FinalJobID != "job-1" || gotReview.ChangeSetID != "cs-1" {
		t.Fatalf("unexpected review: %+v", gotReview)
	}
}

func TestIngestReviewMessagesAndSessionLookup(t *testing.T) {
	db := pgtest.Open(t)

	r1 := &store.IngestReview{SessionID: "sess-a", ArchiveSourcePath: "raw/a.md", DeepOrganize: true}
	if err := db.CreateIngestReview(r1); err != nil {
		t.Fatalf("CreateIngestReview r1: %v", err)
	}
	if !r1.DeepOrganize {
		t.Fatalf("deep_organize not persisted: %+v", r1)
	}

	// Force a distinct created_at so "latest" is deterministic.
	if _, err := db.Pool().Exec(context.Background(),
		`UPDATE ingest_reviews SET created_at = '2000-01-01 00:00:00' WHERE id = $1`, r1.ID); err != nil {
		t.Fatalf("backdate r1: %v", err)
	}
	r2 := &store.IngestReview{SessionID: "sess-a", ArchiveSourcePath: "raw/b.md"}
	if err := db.CreateIngestReview(r2); err != nil {
		t.Fatalf("CreateIngestReview r2: %v", err)
	}

	latest, err := db.GetLatestIngestReviewBySessionID("sess-a")
	if err != nil || latest == nil || latest.ID != r2.ID {
		t.Fatalf("latest = %+v, err %v", latest, err)
	}
	if empty, err := db.GetLatestIngestReviewBySessionID(""); err != nil || empty != nil {
		t.Fatalf("empty session lookup = %+v, err %v", empty, err)
	}
	n, err := db.CountIngestReviewsBySessionID("sess-a")
	if err != nil || n != 2 {
		t.Fatalf("count = %d, err %v", n, err)
	}

	msg := &store.IngestReviewMessage{ReviewID: r1.ID, Content: "please revise"}
	if err := db.CreateIngestReviewMessage(msg); err != nil {
		t.Fatalf("CreateIngestReviewMessage: %v", err)
	}
	if msg.ID == "" || msg.Role != "user" || msg.MessageType != "feedback" {
		t.Fatalf("unexpected review message: %+v", msg)
	}
	msgs, err := db.ListIngestReviewMessages(r1.ID)
	if err != nil || len(msgs) != 1 || msgs[0].Content != "please revise" {
		t.Fatalf("review messages = %+v, err %v", msgs, err)
	}

	if err := db.DeleteIngestReview(r1.ID); err != nil {
		t.Fatalf("DeleteIngestReview: %v", err)
	}
	if got, err := db.GetIngestReview(r1.ID); err != nil || got != nil {
		t.Fatalf("deleted review = %+v, err %v", got, err)
	}
}
