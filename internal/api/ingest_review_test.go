package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func setupReviewRoutes(api *API, r chi.Router) {
	setupSessionRoutes(api, r)
	r.Route("/api/v1/ingest/reviews", func(r chi.Router) {
		r.Get("/", api.ListIngestReviews)
		r.Get("/{id}", api.GetIngestReview)
		r.Get("/{id}/plans", api.ListIngestReviewPlans)
		r.Post("/{id}/feedback", api.AddIngestReviewFeedback)
		r.Post("/{id}/replan", api.ReplanIngestReview)
		r.Post("/{id}/approve", api.ApproveIngestReview)
	})
}

func TestGetSessionIncludesActiveReview(t *testing.T) {
	api, r := setupTestAPI(t)
	setupReviewRoutes(api, r)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var created struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	_ = json.NewDecoder(w.Body).Decode(&created)

	body, _ := json.Marshal(map[string]string{"content": "hello"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/messages", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/archive", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var arch struct {
		ReviewID string `json:"review_id"`
	}
	_ = json.NewDecoder(w.Body).Decode(&arch)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/ingest/sessions/"+created.Session.ID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get session: %d %s", w.Code, w.Body.String())
	}
	var detail struct {
		ActiveReview *struct {
			ReviewID string `json:"review_id"`
			Status   string `json:"status"`
		} `json:"active_review"`
	}
	_ = json.NewDecoder(w.Body).Decode(&detail)
	if detail.ActiveReview == nil {
		t.Fatal("expected active_review")
	}
	if detail.ActiveReview.ReviewID != arch.ReviewID {
		t.Fatalf("review_id = %q, want %q", detail.ActiveReview.ReviewID, arch.ReviewID)
	}
}

func TestGetReviewReturnsMergeCommitSHA(t *testing.T) {
	api, r := setupTestAPI(t)
	setupReviewRoutes(api, r)

	review := &sqlite.IngestReview{
		SessionID:         "sess-1",
		ArchiveSourcePath: "raw/test.md",
		Status:            "succeeded",
	}
	if err := api.db.CreateIngestReview(review); err != nil {
		t.Fatal(err)
	}
	if err := api.db.SetIngestReviewMergeCommitSHA(review.ID, "deadbeef"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/reviews/"+review.ID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get review: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Review struct {
			MergeCommitSHA string `json:"merge_commit_sha"`
		} `json:"review"`
	}
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.Review.MergeCommitSHA != "deadbeef" {
		t.Fatalf("merge_commit_sha = %q", resp.Review.MergeCommitSHA)
	}
}

func TestArchiveCreatesReview(t *testing.T) {
	api, r := setupTestAPI(t)
	setupReviewRoutes(api, r)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var created struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	_ = json.NewDecoder(w.Body).Decode(&created)

	body, _ := json.Marshal(map[string]string{"content": "hello"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/messages", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	req = httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/"+created.Session.ID+"/archive", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("archive: %d %s", w.Code, w.Body.String())
	}
	var arch struct {
		ReviewID string `json:"review_id"`
	}
	_ = json.NewDecoder(w.Body).Decode(&arch)
	if arch.ReviewID == "" {
		t.Fatal("expected review_id")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/ingest/reviews/"+arch.ReviewID, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get review: %d %s", w.Code, w.Body.String())
	}
}
