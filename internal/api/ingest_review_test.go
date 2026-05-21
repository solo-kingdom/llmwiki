package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
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
