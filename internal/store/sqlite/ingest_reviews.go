package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
)

type IngestReview struct {
	ID                  string `json:"id"`
	SessionID           string `json:"session_id"`
	ArchiveSourcePath   string `json:"archive_source_path"`
	Status              string `json:"status"`
	CurrentPlanVersion  int    `json:"current_plan_version"`
	ApprovedPlanVersion int    `json:"approved_plan_version"`
	FinalJobID          string `json:"final_job_id,omitempty"`
	MergeCommitSHA      string `json:"merge_commit_sha,omitempty"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
	DeepOrganize        bool   `json:"deep_organize"`
}

// ActiveReviewSummary is a lightweight review snapshot for session detail API.
type ActiveReviewSummary struct {
	ReviewID           string `json:"review_id"`
	Status             string `json:"status"`
	CurrentPlanVersion int    `json:"current_plan_version"`
	MergeCommitSHA     string `json:"merge_commit_sha,omitempty"`
}

func ActiveReviewSummaryFromReview(r *IngestReview) *ActiveReviewSummary {
	if r == nil || r.ID == "" {
		return nil
	}
	if r.Status == "cancelled" {
		return nil
	}
	return &ActiveReviewSummary{
		ReviewID:           r.ID,
		Status:             r.Status,
		CurrentPlanVersion: r.CurrentPlanVersion,
		MergeCommitSHA:     r.MergeCommitSHA,
	}
}

type IngestReviewMessage struct {
	ID          string `json:"id"`
	ReviewID    string `json:"review_id"`
	Role        string `json:"role"`
	MessageType string `json:"message_type"`
	Content     string `json:"content"`
	CreatedAt   string `json:"created_at"`
}

type IngestReviewPlan struct {
	ID            string `json:"id"`
	ReviewID      string `json:"review_id"`
	Version       int    `json:"version"`
	PlanMarkdown  string `json:"plan_markdown"`
	PlanJSON      string `json:"plan_json"`
	CreatedAt     string `json:"created_at"`
}

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
	COALESCE(merge_commit_sha, ''),
	COALESCE(created_at, ''), COALESCE(updated_at, ''),
	COALESCE(deep_organize, 0)`

func scanIngestReview(scanner interface{ Scan(...interface{}) error }, r *IngestReview) error {
	return scanner.Scan(
		&r.ID,
		&r.SessionID,
		&r.ArchiveSourcePath,
		&r.Status,
		&r.CurrentPlanVersion,
		&r.ApprovedPlanVersion,
		&r.FinalJobID,
		&r.MergeCommitSHA,
		&r.CreatedAt,
		&r.UpdatedAt,
		&r.DeepOrganize,
	)
}

func (d *DB) CreateIngestReview(r *IngestReview) error {
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
	_, err := d.db.Exec(`
		INSERT INTO ingest_reviews (
			session_id, archive_source_path, status,
			current_plan_version, approved_plan_version, final_job_id,
			deep_organize
		) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.SessionID, r.ArchiveSourcePath, r.Status,
		r.CurrentPlanVersion, r.ApprovedPlanVersion, r.FinalJobID,
		r.DeepOrganize,
	)
	if err != nil {
		return err
	}
	row := d.db.QueryRow(`SELECT `+ingestReviewSelectColumns+` FROM ingest_reviews WHERE rowid = last_insert_rowid()`)
	return scanIngestReview(row, r)
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

func (d *DB) GetLatestIngestReviewBySessionID(sessionID string) (*IngestReview, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, nil
	}
	row := d.db.QueryRow(`
		SELECT `+ingestReviewSelectColumns+`
		FROM ingest_reviews
		WHERE session_id = ?
		ORDER BY rowid DESC
		LIMIT 1`, sessionID)
	var r IngestReview
	if err := scanIngestReview(row, &r); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func (d *DB) CountIngestReviewsBySessionID(sessionID string) (int, error) {
	var n int
	err := d.db.QueryRow(`
		SELECT COUNT(*) FROM ingest_reviews WHERE session_id = ?`, sessionID).Scan(&n)
	return n, err
}

func (d *DB) DeleteIngestReview(id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("review id is required")
	}
	_, err := d.db.Exec(`DELETE FROM ingest_reviews WHERE id = ?`, id)
	return err
}

func (d *DB) GetIngestReview(id string) (*IngestReview, error) {
	row := d.db.QueryRow(`SELECT `+ingestReviewSelectColumns+` FROM ingest_reviews WHERE id = ?`, id)
	var r IngestReview
	if err := scanIngestReview(row, &r); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func (d *DB) ListIngestReviews(limit int) ([]IngestReview, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.db.Query(`
		SELECT `+ingestReviewSelectColumns+`
		FROM ingest_reviews
		ORDER BY datetime(updated_at) DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IngestReview
	for rows.Next() {
		var r IngestReview
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
		_, err = d.db.Exec(`UPDATE ingest_reviews SET updated_at = datetime('now') WHERE id = ?`, id)
		return err
	}
	if !canTransitionReviewStatus(cur.Status, newStatus) {
		return fmt.Errorf("invalid review status transition: %s -> %s", cur.Status, newStatus)
	}
	_, err = d.db.Exec(`
		UPDATE ingest_reviews SET status = ?, updated_at = datetime('now') WHERE id = ?`,
		newStatus, id,
	)
	return err
}

func (d *DB) SetIngestReviewPlanVersion(id string, version int) error {
	_, err := d.db.Exec(`
		UPDATE ingest_reviews SET current_plan_version = ?, updated_at = datetime('now') WHERE id = ?`,
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
	_, err = d.db.Exec(`
		UPDATE ingest_reviews
		SET approved_plan_version = ?, updated_at = datetime('now')
		WHERE id = ?`, version, id)
	return err
}

func (d *DB) SetIngestReviewFinalJob(id, jobID string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_reviews SET final_job_id = ?, updated_at = datetime('now') WHERE id = ?`,
		jobID, id,
	)
	return err
}

func (d *DB) SetIngestReviewMergeCommitSHA(id, sha string) error {
	_, err := d.db.Exec(`
		UPDATE ingest_reviews SET merge_commit_sha = ?, updated_at = datetime('now') WHERE id = ?`,
		sha, id,
	)
	return err
}

func (d *DB) CreateIngestReviewMessage(m *IngestReviewMessage) error {
	if m == nil || m.ReviewID == "" {
		return fmt.Errorf("review_id is required")
	}
	if m.Role == "" {
		m.Role = "user"
	}
	if m.MessageType == "" {
		m.MessageType = "feedback"
	}
	_, err := d.db.Exec(`
		INSERT INTO ingest_review_messages (review_id, role, message_type, content)
		VALUES (?, ?, ?, ?)`,
		m.ReviewID, m.Role, m.MessageType, m.Content,
	)
	if err != nil {
		return err
	}
	row := d.db.QueryRow(`
		SELECT COALESCE(id,''), COALESCE(review_id,''), COALESCE(role,''),
		       COALESCE(message_type,''), COALESCE(content,''), COALESCE(created_at,'')
		FROM ingest_review_messages WHERE rowid = last_insert_rowid()`)
	return row.Scan(&m.ID, &m.ReviewID, &m.Role, &m.MessageType, &m.Content, &m.CreatedAt)
}

func (d *DB) ListIngestReviewMessages(reviewID string) ([]IngestReviewMessage, error) {
	rows, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(review_id,''), COALESCE(role,''),
		       COALESCE(message_type,''), COALESCE(content,''), COALESCE(created_at,'')
		FROM ingest_review_messages
		WHERE review_id = ?
		ORDER BY datetime(created_at) ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IngestReviewMessage
	for rows.Next() {
		var m IngestReviewMessage
		if err := rows.Scan(&m.ID, &m.ReviewID, &m.Role, &m.MessageType, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (d *DB) CreateIngestReviewPlan(p *IngestReviewPlan) error {
	if p == nil || p.ReviewID == "" {
		return fmt.Errorf("review_id is required")
	}
	if p.Version <= 0 {
		return fmt.Errorf("plan version must be positive")
	}
	_, err := d.db.Exec(`
		INSERT INTO ingest_review_plans (review_id, version, plan_markdown, plan_json)
		VALUES (?, ?, ?, ?)`,
		p.ReviewID, p.Version, p.PlanMarkdown, p.PlanJSON,
	)
	if err != nil {
		return err
	}
	row := d.db.QueryRow(`
		SELECT COALESCE(id,''), COALESCE(review_id,''), COALESCE(version,0),
		       COALESCE(plan_markdown,''), COALESCE(plan_json,''), COALESCE(created_at,'')
		FROM ingest_review_plans WHERE review_id = ? AND version = ?`,
		p.ReviewID, p.Version)
	return row.Scan(&p.ID, &p.ReviewID, &p.Version, &p.PlanMarkdown, &p.PlanJSON, &p.CreatedAt)
}

func (d *DB) ListIngestReviewPlans(reviewID string) ([]IngestReviewPlan, error) {
	rows, err := d.db.Query(`
		SELECT COALESCE(id,''), COALESCE(review_id,''), COALESCE(version,0),
		       COALESCE(plan_markdown,''), COALESCE(plan_json,''), COALESCE(created_at,'')
		FROM ingest_review_plans
		WHERE review_id = ?
		ORDER BY version ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IngestReviewPlan
	for rows.Next() {
		var p IngestReviewPlan
		if err := rows.Scan(&p.ID, &p.ReviewID, &p.Version, &p.PlanMarkdown, &p.PlanJSON, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (d *DB) GetIngestReviewPlan(reviewID string, version int) (*IngestReviewPlan, error) {
	row := d.db.QueryRow(`
		SELECT COALESCE(id,''), COALESCE(review_id,''), COALESCE(version,0),
		       COALESCE(plan_markdown,''), COALESCE(plan_json,''), COALESCE(created_at,'')
		FROM ingest_review_plans
		WHERE review_id = ? AND version = ?`, reviewID, version)
	var p IngestReviewPlan
	if err := row.Scan(&p.ID, &p.ReviewID, &p.Version, &p.PlanMarkdown, &p.PlanJSON, &p.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (d *DB) NextIngestReviewPlanVersion(reviewID string) (int, error) {
	var v int
	err := d.db.QueryRow(`
		SELECT COALESCE(MAX(version), 0) FROM ingest_review_plans WHERE review_id = ?`,
		reviewID).Scan(&v)
	if err != nil {
		return 0, err
	}
	return v + 1, nil
}
