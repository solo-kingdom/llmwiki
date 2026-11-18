package store

import (
	"fmt"
	"strings"
)

// ConfigAPIToken stores the optional management API token set from Settings.
const ConfigAPIToken = "api_token"

// ActiveIngestReviewStatuses are review states where a duplicate archive must not create a new review.
var ActiveIngestReviewStatuses = map[string]bool{
	"planning":         true,
	"ready_for_review": true,
	"revising":         true,
	"approved":         true,
	"applying":         true,
}

// IsActiveIngestReviewStatus reports whether status blocks a duplicate review.
func IsActiveIngestReviewStatus(status string) bool {
	return ActiveIngestReviewStatuses[strings.TrimSpace(status)]
}

// ActiveReviewSummaryFromReview builds the lightweight summary used by the session API.
func ActiveReviewSummaryFromReview(r *IngestReview) *ActiveReviewSummary {
	if r == nil || r.ID == "" || r.Status == "cancelled" {
		return nil
	}
	return &ActiveReviewSummary{
		ReviewID:           r.ID,
		Status:             r.Status,
		CurrentPlanVersion: r.CurrentPlanVersion,
		ChangeSetID:        r.ChangeSetID,
	}
}

// ParseJobEventsMaxCount validates the job event retention setting.
func ParseJobEventsMaxCount(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return DefaultJobEventsMaxCount, nil
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, fmt.Errorf("invalid ingest_job_events_max_count: %q", s)
	}
	if n < MinJobEventsMaxCount || n > MaxJobEventsMaxCount {
		return 0, fmt.Errorf("ingest_job_events_max_count must be between %d and %d", MinJobEventsMaxCount, MaxJobEventsMaxCount)
	}
	return n, nil
}

// ParseSessionMsgEventsMaxCount validates the session message event retention setting.
func ParseSessionMsgEventsMaxCount(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return DefaultSessionMsgEventsMaxCount, nil
	}
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		return 0, fmt.Errorf("invalid session_message_events_max_count: %q", s)
	}
	if n < MinSessionMsgEventsMaxCount || n > MaxSessionMsgEventsMaxCount {
		return 0, fmt.Errorf("session_message_events_max_count must be between %d and %d", MinSessionMsgEventsMaxCount, MaxSessionMsgEventsMaxCount)
	}
	return n, nil
}
