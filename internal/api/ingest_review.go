package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type reviewResponse struct {
	Review *sqlite.IngestReview `json:"review"`
}

type reviewsListResponse struct {
	Reviews []sqlite.IngestReview `json:"reviews"`
}

type reviewPlansResponse struct {
	Plans []sqlite.IngestReviewPlan `json:"plans"`
}

type reviewMessageResponse struct {
	Message *sqlite.IngestReviewMessage `json:"message"`
}

type reviewActionResponse struct {
	Review  *sqlite.IngestReview `json:"review"`
	JobID   string               `json:"job_id,omitempty"`
	Status  string               `json:"status"`
	Message string               `json:"message,omitempty"`
}

type feedbackRequest struct {
	Content string `json:"content"`
}

func (a *API) ListIngestReviews(w http.ResponseWriter, r *http.Request) {
	reviews, err := a.db.ListIngestReviews(100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if reviews == nil {
		reviews = []sqlite.IngestReview{}
	}
	writeJSON(w, http.StatusOK, reviewsListResponse{Reviews: reviews})
}

func (a *API) GetIngestReview(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	review, err := a.db.GetIngestReview(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if review == nil {
		writeError(w, http.StatusNotFound, "review not found")
		return
	}
	writeJSON(w, http.StatusOK, reviewResponse{Review: review})
}

func (a *API) ListIngestReviewPlans(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	review, err := a.db.GetIngestReview(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if review == nil {
		writeError(w, http.StatusNotFound, "review not found")
		return
	}
	plans, err := a.db.ListIngestReviewPlans(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if plans == nil {
		plans = []sqlite.IngestReviewPlan{}
	}
	writeJSON(w, http.StatusOK, reviewPlansResponse{Plans: plans})
}

func (a *API) AddIngestReviewFeedback(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	review, err := a.loadReview(id, w)
	if err != nil || review == nil {
		return
	}
	if review.Status != "ready_for_review" && review.Status != "failed" {
		writeError(w, http.StatusConflict, "feedback only allowed when review is ready or failed")
		return
	}
	var req feedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	msg := &sqlite.IngestReviewMessage{
		ReviewID:    id,
		Role:        "user",
		MessageType: "feedback",
		Content:     content,
	}
	if err := a.db.CreateIngestReviewMessage(msg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, reviewMessageResponse{Message: msg})
}

func (a *API) ReplanIngestReview(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	review, err := a.loadReview(id, w)
	if err != nil || review == nil {
		return
	}
	if review.Status != "ready_for_review" && review.Status != "failed" {
		writeError(w, http.StatusConflict, "replan only allowed from ready_for_review or failed")
		return
	}
	if err := a.db.UpdateIngestReviewStatus(id, "revising"); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	job, err := ingest.EnqueueReviewPlanJob(a.db, a.workspace, review)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	review, _ = a.db.GetIngestReview(id)
	a.logReviewLifecycle(id, review.SessionID, "review_replanning", "replan queued", "pending")
	writeJSON(w, http.StatusAccepted, reviewActionResponse{
		Review:  review,
		JobID:   job.ID,
		Status:  review.Status,
		Message: "replan started",
	})
}

func (a *API) ApproveIngestReview(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	review, err := a.loadReview(id, w)
	if err != nil || review == nil {
		return
	}
	if review.Status != "ready_for_review" {
		writeError(w, http.StatusConflict, "approve only allowed when ready_for_review")
		return
	}
	if review.CurrentPlanVersion <= 0 {
		writeError(w, http.StatusConflict, "no plan version to approve")
		return
	}
	if err := a.db.SetIngestReviewApprovedPlan(id, review.CurrentPlanVersion); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err := a.db.UpdateIngestReviewStatus(id, "approved"); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	review, _ = a.db.GetIngestReview(id)
	job, err := ingest.EnqueueReviewApplyJob(a.db, a.workspace, review)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.logReviewLifecycle(id, review.SessionID, "review_approved", "approved; apply queued", "success")
	writeJSON(w, http.StatusAccepted, reviewActionResponse{
		Review:  review,
		JobID:   job.ID,
		Status:  review.Status,
		Message: "apply started",
	})
}

func (a *API) loadReview(id string, w http.ResponseWriter) (*sqlite.IngestReview, error) {
	review, err := a.db.GetIngestReview(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil, err
	}
	if review == nil {
		writeError(w, http.StatusNotFound, "review not found")
		return nil, fmt.Errorf("not found")
	}
	return review, nil
}

func (a *API) logReviewLifecycle(reviewID, sessionID, action, message, status string) {
	details := map[string]interface{}{"review_id": reviewID}
	if sessionID != "" {
		details["session_id"] = sessionID
	}
	activity.Record(a.db, activity.Entry{
		Level:        "info",
		Category:     "ingest",
		Action:       action,
		Message:      message,
		ResourceType: "review",
		ResourceID:   reviewID,
		Status:       status,
		Source:       "api",
		Details:      details,
	})
}
