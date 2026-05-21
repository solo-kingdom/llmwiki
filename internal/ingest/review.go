package ingest

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	InputKindReviewPlan  InputKind = "review_plan"
	InputKindReviewApply InputKind = "review_apply"
)

// ReviewRefPrefix is the source_ref prefix for review-scoped ingest jobs.
const ReviewRefPrefix = "review:"

func ReviewSourceRef(reviewID string) string {
	return ReviewRefPrefix + reviewID
}

func ParseReviewIDFromRef(sourceRef string) (string, bool) {
	if !strings.HasPrefix(sourceRef, ReviewRefPrefix) {
		return "", false
	}
	id := strings.TrimPrefix(sourceRef, ReviewRefPrefix)
	if id == "" {
		return "", false
	}
	return id, true
}

// PlanResult holds human-readable and machine-readable plan outputs.
type PlanResult struct {
	PlanMarkdown string
	PlanJSON     string
}

// ParsePlanResult extracts plan markdown and JSON from an LLM plan step response.
func ParsePlanResult(raw string) (*PlanResult, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty plan response")
	}
	planJSON := extractJSONFromPlan(raw)
	if planJSON == "" {
		planJSON = `{"summary":"","changes":[]}`
	}
	var probe map[string]interface{}
	if err := json.Unmarshal([]byte(planJSON), &probe); err != nil {
		return nil, fmt.Errorf("invalid plan json: %w", err)
	}
	markdown := strings.TrimSpace(stripJSONFence(raw))
	if markdown == "" {
		if s, ok := probe["summary"].(string); ok {
			markdown = s
		}
	}
	return &PlanResult{PlanMarkdown: markdown, PlanJSON: planJSON}, nil
}

func extractJSONFromPlan(raw string) string {
	for _, marker := range []string{"```json", "```"} {
		idx := strings.Index(raw, marker)
		if idx < 0 {
			continue
		}
		rest := raw[idx+len(marker):]
		end := strings.Index(rest, "```")
		if end > 0 {
			return strings.TrimSpace(rest[:end])
		}
	}
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start >= 0 && end > start {
		return raw[start : end+1]
	}
	return ""
}

func stripJSONFence(raw string) string {
	for _, marker := range []string{"```json", "```"} {
		if idx := strings.Index(raw, marker); idx >= 0 {
			return strings.TrimSpace(raw[:idx])
		}
	}
	return raw
}

func FormatFeedbackForPlan(feedback []string) string {
	if len(feedback) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("User feedback to incorporate:\n")
	for i, f := range feedback {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		fmt.Fprintf(&b, "%d. %s\n", i+1, f)
	}
	return b.String()
}
