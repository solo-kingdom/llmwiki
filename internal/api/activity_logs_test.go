package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func setupActivityLogsRoutes(api *API, r chi.Router) {
	r.Get("/api/v1/logs", api.ListActivityLogsHandler)
	r.Delete("/api/v1/logs", api.DeleteAllActivityLogsHandler)
	r.Get("/api/v1/settings", api.GetSettings)
	r.Put("/api/v1/settings", api.UpdateSettings)
}

func TestActivityLogsAPI(t *testing.T) {
	activity.Start()
	t.Cleanup(activity.Stop)

	api, r := setupTestAPI(t)
	setupActivityLogsRoutes(api, r)

	for i := 0; i < 3; i++ {
		_ = api.db.CreateActivityLog(&sqlite.ActivityLog{
			Category: "ingest",
			Action:   "queued",
			Message:  "test",
			Level:    "info",
		})
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/logs?limit=10&category=ingest", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	var list struct {
		Logs  []sqlite.ActivityLog `json:"logs"`
		Total int                  `json:"total"`
	}
	json.NewDecoder(w.Body).Decode(&list)
	if len(list.Logs) != 3 || list.Total != 3 {
		t.Fatalf("list = %+v", list)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/logs", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}

	logs, _ := api.db.ListActivityLogs(sqlite.ActivityLogListFilter{Limit: 10})
	if len(logs) != 1 || logs[0].Action != "logs_cleared" {
		t.Fatalf("after clear expected logs_cleared, got %+v", logs)
	}
}

func TestActivityLogsMaxCountSettings(t *testing.T) {
	api, r := setupTestAPI(t)
	setupActivityLogsRoutes(api, r)

	for i := 0; i < 105; i++ {
		_ = api.db.CreateActivityLog(&sqlite.ActivityLog{
			Category: "system",
			Action:   "test",
			Message:  "x",
		})
	}

	body, _ := json.Marshal(map[string]interface{}{
		"activity_logs_max_count": 100,
	})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("settings: %d %s", w.Code, w.Body.String())
	}

	count, _ := api.db.CountActivityLogs("", "")
	if count > 101 {
		t.Fatalf("count after trim = %d, expected <=101 (100 max + possible logs_trimmed)", count)
	}
}
