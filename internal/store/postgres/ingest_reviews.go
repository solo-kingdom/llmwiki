package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/solo-kingdom/llmwiki/internal/store"
)

var validReviewStatuses = map[string]bool{
	"planning":         true,
	"ready_for_review": true,
	"revising":         true,
	"approved":         true,
	"applying":         true,
	"succeeded":        true,
	"failed":           true,
	"cancelled":        true,
}

var allowedReviewTransitions = map[string][]string{
	"planning":         {"ready_for_review", "failed", "cancelled"},
	"ready_for_review": {"revising", "approved", "cancelled"},
	"revising":         {"ready_for_review", "failed", "cancelled"},
	"approved":         {"applying"},
	"applying":         {"succeeded", "failed"},
	"failed":           {"revising", "cancelled"},
}

func validateReviewStatus(status string) error {
	s := strings.TrimSpace(status)
	if !validReviewStatuses[s] {
		return fmt.Errorf("invalid ingest review status: %s", status)
	}
	return nil
}

func canTransitionReviewStatus(from, to string) bool {
	allowed, ok := allowedReviewTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

const ingestReviewSelectColumns = `
	COALESCE(id, ''), COALESCE(session_id, ''), COALESCE(archive_source_path, ''),
	COALESCE(status, ''), COALESCE(current_plan_version, 0),
	COALESCE(approved_plan_version, 0), COALESCE(final_job_id, ''),
	COALESCE(change_set_id, ''),
	COALESCE(created_at, ''), COALESCE(updated_at, ''),
	COALESCE(deep_organize, FALSE)`

const ingestReviewMessageSelectColumns = `
	COALESCE(id, ''), COALESCE(review_id, ''), COALESCE(role, ''),
	COALESCE(message_type, ''), COALESCE(content, ''), COALESCE(created_at, '')`

const ingestReviewPlanSelectColumns = `
	COALESCE(id, ''), COALESCE(review_id, ''), COALESCE(version, 0),
	COALESCE(plan_markdown, ''), COALESCE(plan_json, ''), COALESCE(created_at, '')`

func scanIngestReview(scanner interface{ Scan(...any) error }, r *store.IngestReview) error {
	return scanner.Scan(
		&r.ID,
		&r.SessionID,
		&r.ArchiveSourcePath,
		&r.Status,
		&r.CurrentPlanVersion,
		&r.ApprovedPlanVersion,
		&r.FinalJobID,
		&r.ChangeSetID,
		&r.CreatedAt,
		&r.UpdatedAt,
		&r.DeepOrganize,
	)
}

func (d *DB) CreateIngestReview(r *store.IngestReview) error {
	if r == nil {
		return fmt.Errorf("nil ingest review")
	}
	if r.ArchiveSourcePath == "" {
		return fmt.Errorf("archive_source_path is required")
	}
	if r.Status == "" {
		r.Status = "planning"
	}
	if err := validateReviewStatus(r.Status); err != nil {
		return err
	}
	err := scanIngestReview(d.pool.QueryRow(context.Background(), `
		INSERT INTO ingest_reviews (
			id, session_id, archive_source_path, status,
			current_plan_version, approved_plan_version, final_job_id,
			deep_organize, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, `+nowText+`, `+nowText+`)
		RETURNING `+ingestReviewSelectColumns,
		uuid.New().String(), r.SessionID, r.ArchiveSourcePath, r.Status,
		r.CurrentPlanVersion, r.ApprovedPlanVersion, r.FinalJobID,
		r.DeepOrganize,
	), r)
	if err != nil {
		return fmt.Errorf("create ingest review: %w", err)
	}
	return nil
}

// ActiveIngestReviewStatuses are review states where a duplicate archive must not create a new review.
var ActiveIngestReviewStatuses = map[string]bool{
	"planning":         true,
	"ready_for_review": true,
	"revising":         true,
	"approved":         true,
	"applying":         true,
}

func IsActiveIngestReviewStatus(status string) bool {
	return ActiveIngestReviewStatuses[strings.TrimSpace(status)]
}

func (d *DB) GetLatestIngestReviewBySessionID(sessionID string) (*store.IngestReview, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, nil
	}
	var r store.IngestReview
	err := scanIngestReview(d.pool.QueryRow(context.Background(), `
		SELECT `+ingestReviewSelectColumns+`
		FROM ingest_reviews
		WHERE session_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT 1`, sessionID), &r)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func (d *DB) CountIngestReviewsBySessionID(sessionID string) (int, error) {
	var n int
	err := d.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM ingest_reviews WHERE session_id = $1`, sessionID).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

func (d *DB) DeleteIngestReview(id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("review id is required")
	}
	_, err := d.pool.Exec(context.Background(), `DELETE FROM ingest_reviews WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete ingest review: %w", err)
	}
	return nil
}

func (d *DB) GetIngestReview(id string) (*store.IngestReview, error) {
	var r store.IngestReview
	err := scanIngestReview(d.pool.QueryRow(context.Background(), `
		SELECT `+ingestReviewSelectColumns+` FROM ingest_reviews WHERE id = $1`, id), &r)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func (d *DB) ListIngestReviews(limit int) ([]store.IngestReview, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.pool.Query(context.Background(), `
		SELECT `+ingestReviewSelectColumns+`
		FROM ingest_reviews
		ORDER BY updated_at DESC, id DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.IngestReview
	for rows.Next() {
		var r store.IngestReview
		if err := scanIngestReview(rows, &r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *DB) UpdateIngestReviewStatus(id, newStatus string) error {
	if err := validateReviewStatus(newStatus); err != nil {
		return err
	}
	cur, err := d.GetIngestReview(id)
	if err != nil {
		return err
	}
	if cur == nil {
		return fmt.Errorf("review not found: %s", id)
	}
	if cur.Status == newStatus {
		_, err = d.pool.Exec(context.Background(),
			`UPDATE ingest_reviews SET updated_at = `+nowText+` WHERE id = $1`, id)
		return err
	}
	if !canTransitionReviewStatus(cur.Status, newStatus) {
		return fmt.Errorf("invalid review status transition: %s -> %s", cur.Status, newStatus)
	}
	_, err = d.pool.Exec(context.Background(), `
		UPDATE ingest_reviews SET status = $1, updated_at = `+nowText+` WHERE id = $2`,
		newStatus, id,
	)
	return err
}

func (d *DB) SetIngestReviewPlanVersion(id string, version int) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_reviews SET current_plan_version = $1, updated_at = `+nowText+` WHERE id = $2`,
		version, id,
	)
	return err
}

func (d *DB) SetIngestReviewApprovedPlan(id string, version int) error {
	cur, err := d.GetIngestReview(id)
	if err != nil {
		return err
	}
	if cur == nil {
		return fmt.Errorf("review not found: %s", id)
	}
	if version <= 0 {
		return fmt.Errorf("approved plan version must be positive")
	}
	if version > cur.CurrentPlanVersion {
		return fmt.Errorf("approved version %d exceeds current %d", version, cur.CurrentPlanVersion)
	}
	_, err = d.pool.Exec(context.Background(), `
		UPDATE ingest_reviews
		SET approved_plan_version = $1, updated_at = `+nowText+`
		WHERE id = $2`, version, id)
	return err
}

func (d *DB) SetIngestReviewFinalJob(id, jobID string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_reviews SET final_job_id = $1, updated_at = `+nowText+` WHERE id = $2`,
		jobID, id,
	)
	return err
}

func (d *DB) SetIngestReviewChangeSet(id, changeSetID string) error {
	_, err := d.pool.Exec(context.Background(), `
		UPDATE ingest_reviews SET change_set_id = $1, updated_at = `+nowText+` WHERE id = $2`,
		changeSetID, id,
	)
	return err
}

func (d *DB) CreateIngestReviewMessage(m *store.IngestReviewMessage) error {
	if m == nil || m.ReviewID == "" {
		return fmt.Errorf("review_id is required")
	}
	if m.Role == "" {
		m.Role = "user"
	}
	if m.MessageType == "" {
		m.MessageType = "feedback"
	}
	err := d.pool.QueryRow(context.Background(), `
		INSERT INTO ingest_review_messages (id, review_id, role, message_type, content, created_at)
		VALUES ($1, $2, $3, $4, $5, `+nowText+`)
		RETURNING `+ingestReviewMessageSelectColumns,
		uuid.New().String(), m.ReviewID, m.Role, m.MessageType, m.Content,
	).Scan(&m.ID, &m.ReviewID, &m.Role, &m.MessageType, &m.Content, &m.CreatedAt)
	if err != nil {
		return fmt.Errorf("create ingest review message: %w", err)
	}
	return nil
}

func (d *DB) ListIngestReviewMessages(reviewID string) ([]store.IngestReviewMessage, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT `+ingestReviewMessageSelectColumns+`
		FROM ingest_review_messages
		WHERE review_id = $1
		ORDER BY created_at ASC, id ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.IngestReviewMessage
	for rows.Next() {
		var m store.IngestReviewMessage
		if err := rows.Scan(&m.ID, &m.ReviewID, &m.Role, &m.MessageType, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (d *DB) CreateIngestReviewPlan(p *store.IngestReviewPlan) error {
	if p == nil || p.ReviewID == "" {
		return fmt.Errorf("review_id is required")
	}
	if p.Version <= 0 {
		return fmt.Errorf("plan version must be positive")
	}
	err := d.pool.QueryRow(context.Background(), `
		INSERT INTO ingest_review_plans (id, review_id, version, plan_markdown, plan_json, created_at)
		VALUES ($1, $2, $3, $4, $5, `+nowText+`)
		RETURNING `+ingestReviewPlanSelectColumns,
		uuid.New().String(), p.ReviewID, p.Version, p.PlanMarkdown, p.PlanJSON,
	).Scan(&p.ID, &p.ReviewID, &p.Version, &p.PlanMarkdown, &p.PlanJSON, &p.CreatedAt)
	if err != nil {
		return fmt.Errorf("create ingest review plan: %w", err)
	}
	return nil
}

func (d *DB) ListIngestReviewPlans(reviewID string) ([]store.IngestReviewPlan, error) {
	rows, err := d.pool.Query(context.Background(), `
		SELECT `+ingestReviewPlanSelectColumns+`
		FROM ingest_review_plans
		WHERE review_id = $1
		ORDER BY version ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []store.IngestReviewPlan
	for rows.Next() {
		var p store.IngestReviewPlan
		if err := rows.Scan(&p.ID, &p.ReviewID, &p.Version, &p.PlanMarkdown, &p.PlanJSON, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (d *DB) GetIngestReviewPlan(reviewID string, version int) (*store.IngestReviewPlan, error) {
	var p store.IngestReviewPlan
	err := d.pool.QueryRow(context.Background(), `
		SELECT `+ingestReviewPlanSelectColumns+`
		FROM ingest_review_plans
		WHERE review_id = $1 AND version = $2`, reviewID, version).
		Scan(&p.ID, &p.ReviewID, &p.Version, &p.PlanMarkdown, &p.PlanJSON, &p.CreatedAt)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (d *DB) NextIngestReviewPlanVersion(reviewID string) (int, error) {
	var v int
	err := d.pool.QueryRow(context.Background(), `
		SELECT COALESCE(MAX(version), 0) FROM ingest_review_plans WHERE review_id = $1`,
		reviewID).Scan(&v)
	if err != nil {
		return 0, err
	}
	return v + 1, nil
}
