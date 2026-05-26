package api

import (
	"net/http"
	"strconv"

	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type activityLogsListResponse struct {
	Logs    []sqlite.ActivityLog `json:"logs"`
	Total   int                  `json:"total"`
	Limit   int                  `json:"limit"`
	Offset  int                  `json:"offset"`
	HasMore bool                 `json:"has_more"`
}

type deleteActivityLogsResponse struct {
	DeletedCount int64 `json:"deleted_count"`
}

// ListActivityLogsHandler handles GET /api/v1/logs.
func (a *API) ListActivityLogsHandler(w http.ResponseWriter, r *http.Request) {
	limit := parseQueryInt(r, "limit", 50)
	offset := parseQueryInt(r, "offset", 0)
	category := r.URL.Query().Get("category")
	level := r.URL.Query().Get("level")

	filter := sqlite.ActivityLogListFilter{
		Limit:    limit,
		Offset:   offset,
		Category: category,
		Level:    level,
	}
	logs, err := a.db.ListActivityLogs(filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	total, err := a.db.CountActivityLogs(category, level)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, activityLogsListResponse{
		Logs:    logs,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		HasMore: offset+len(logs) < total,
	})
}

// DeleteAllActivityLogsHandler handles DELETE /api/v1/logs.
func (a *API) DeleteAllActivityLogsHandler(w http.ResponseWriter, r *http.Request) {
	deleted, err := a.db.DeleteAllActivityLogs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	activity.RecordSync(a.db, activity.Entry{
		Level:    "info",
		Category: "system",
		Action:   "logs_cleared",
		Message:  "已清空全部系统日志",
		Source:   "api",
		Details: map[string]interface{}{
			"deleted_count": deleted,
		},
	})

	writeJSON(w, http.StatusOK, deleteActivityLogsResponse{DeletedCount: deleted})
}

// TrimActivityLogsScheduled runs retention trim (for periodic server loop).
func (a *API) TrimActivityLogsScheduled() (int64, error) {
	return a.trimActivityLogsNow()
}

func (a *API) trimActivityLogsNow() (int64, error) {
	maxCount := activity.GetMaxCount(a.db)
	deleted, err := activity.TrimActivityLogsIfNeeded(a.db, maxCount)
	if err != nil {
		return 0, err
	}
	if deleted > 0 {
		remaining, _ := a.db.CountActivityLogs("", "")
		activity.LogTrimmed(a.db, deleted, maxCount, remaining)
	}
	return deleted, nil
}

func parseQueryInt(r *http.Request, key string, defaultVal int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return defaultVal
	}
	return n
}
