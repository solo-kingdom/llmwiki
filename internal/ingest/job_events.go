package ingest

import (
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

const maxPayloadPreviewBytes = 32 * 1024

// JobRecorder records per-job execution events.
type JobRecorder interface {
	Record(step, phase, message string, payload map[string]any)
}

// SQLiteJobRecorder writes events to ingest_job_events.
type SQLiteJobRecorder struct {
	db    *sqlite.DB
	jobID string
	maxN  int
}

func NewSQLiteJobRecorder(db *sqlite.DB, jobID string) *SQLiteJobRecorder {
	maxN := sqlite.DefaultJobEventsMaxCount
	if db != nil {
		maxN = db.GetJobEventsMaxCount()
	}
	return &SQLiteJobRecorder{db: db, jobID: jobID, maxN: maxN}
}

func (r *SQLiteJobRecorder) Record(step, phase, message string, payload map[string]any) {
	if r == nil || r.db == nil || r.jobID == "" {
		return
	}
	safe := SanitizePayload(payload)
	_ = r.db.InsertIngestJobEvent(r.jobID, step, phase, message, safe, r.maxN)
}

// SanitizePayload removes secrets and truncates large string fields.
func SanitizePayload(payload map[string]any) map[string]any {
	if payload == nil {
		return nil
	}
	out := make(map[string]any, len(payload))
	for k, v := range payload {
		kl := strings.ToLower(k)
		if kl == "api_key" || kl == "authorization" || kl == "x-api-key" {
			continue
		}
		out[k] = sanitizeValue(v)
	}
	return out
}

func sanitizeValue(v any) any {
	switch x := v.(type) {
	case string:
		return truncatePreview(x)
	case map[string]any:
		return SanitizePayload(x)
	case []any:
		arr := make([]any, len(x))
		for i, item := range x {
			arr[i] = sanitizeValue(item)
		}
		return arr
	case []map[string]any:
		arr := make([]any, len(x))
		for i, item := range x {
			arr[i] = SanitizePayload(item)
		}
		return arr
	default:
		return v
	}
}

func truncatePreview(s string) string {
	if len(s) <= maxPayloadPreviewBytes {
		return s
	}
	return s[:maxPayloadPreviewBytes] + "…(truncated)"
}

// RecordLLMRequest builds a payload for analysis/generation request events.
func RecordLLMRequest(rec JobRecorder, step string, model string, messages []map[string]string, temperature float64, maxTokens int) {
	if rec == nil {
		return
	}
	rec.Record(step, "request", step+" LLM request", map[string]any{
		"model":       model,
		"messages":    messages,
		"temperature": temperature,
		"max_tokens":  maxTokens,
	})
}

// RecordLLMResponse builds a payload for analysis/generation response events.
func RecordLLMResponse(rec JobRecorder, step string, content string, duration time.Duration) {
	if rec == nil {
		return
	}
	rec.Record(step, "response", step+" LLM response", map[string]any{
		"content_preview": truncatePreview(content),
		"duration_ms":     duration.Milliseconds(),
		"char_count":      len(content),
	})
}
