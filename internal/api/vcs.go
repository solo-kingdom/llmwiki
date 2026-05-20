package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

// VCStatus represents the version control status response.
type VCStatus struct {
	Enabled      bool              `json:"enabled"`
	CommitCount  int               `json:"commit_count"`
	GitAvailable bool              `json:"git_available"`
	GitVersion   string            `json:"git_version,omitempty"`
	TrackedDirs  []string          `json:"tracked_dirs"`
	ExcludedDirs []string          `json:"excluded_dirs"`
}

// VCInitResponse represents the response from VCS initialization.
type VCInitResponse struct {
	Status     string `json:"status"`
	CommitSHA  string `json:"commit_sha,omitempty"`
	CommitCount int   `json:"commit_count"`
}

// VCLogEntry represents a single commit in the log response.
type VCLogEntry struct {
	SHA         string `json:"sha"`
	Subject     string `json:"subject"`
	Timestamp   string `json:"timestamp"`
	FilesChanged int   `json:"files_changed"`
	IsRollback  bool   `json:"is_rollback"`
}

// VCDiffResponse represents the diff response.
type VCDiffResponse struct {
	SHA  string `json:"sha"`
	Diff string `json:"diff"`
}

// VCSInit handles POST /api/v1/vcs/init
func (a *API) VCSInit(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}

	avail := vcs.IsGitAvailable()
	if !avail.Available {
		writeError(w, http.StatusPreconditionFailed, "git is not installed. Please install git to enable version control")
		return
	}

	repo := vcs.NewGitRepo(a.workspace)
	if repo.IsInitialized() {
		// Already initialized, return current status
		count, _ := repo.CommitCount()
		writeJSON(w, http.StatusOK, VCInitResponse{
			Status:      "already_initialized",
			CommitCount: count,
		})
		return
	}

	repo, err := vcs.InitRepo(a.workspace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to initialize git repo: %v", err))
		return
	}

	// Enable version control in config
	if err := a.db.SetVCEnabled(true); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to set vc_enabled: %v", err))
		return
	}

	count, _ := repo.CommitCount()
	sha, _ := repo.Log(1)

	response := VCInitResponse{
		Status:      "initialized",
		CommitCount: count,
	}
	if len(sha) > 0 {
		response.CommitSHA = sha[0].SHA
	}

	activity.Record(a.db, activity.Entry{
		Level:    "info",
		Category: "vcs",
		Action:   "init",
		Message:  "已启用版本控制",
		Status:   "success",
		Source:   "api",
	})
	writeJSON(w, http.StatusOK, response)
}

// VCSStatus handles GET /api/v1/vcs/status
func (a *API) VCSStatus(w http.ResponseWriter, r *http.Request) {
	avail := vcs.IsGitAvailable()
	vcConfig := a.db.GetVCConfig()

	status := VCStatus{
		Enabled:      vcConfig.Enabled,
		GitAvailable: avail.Available,
		GitVersion:   avail.Version,
		TrackedDirs:  []string{"wiki/"},
		ExcludedDirs: []string{".llmwiki/", "raw/", "revert/"},
	}

	if a.workspace != "" {
		repo := vcs.NewGitRepo(a.workspace)
		if repo.IsInitialized() {
			status.Enabled = true // If .git exists, VC is effectively enabled
			count, err := repo.CommitCount()
			if err == nil {
				status.CommitCount = count
			}
		}
	}

	writeJSON(w, http.StatusOK, status)
}

// VCSDisable handles POST /api/v1/vcs/disable
func (a *API) VCSDisable(w http.ResponseWriter, r *http.Request) {
	if err := a.db.SetVCEnabled(false); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to disable version control: %v", err))
		return
	}

	activity.Record(a.db, activity.Entry{
		Level:    "info",
		Category: "vcs",
		Action:   "disable",
		Message:  "已禁用版本控制",
		Status:   "success",
		Source:   "api",
	})
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "disabled",
		"message": "Version control disabled. Git history is preserved.",
	})
}

// VCSLog handles GET /api/v1/vcs/log
func (a *API) VCSLog(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}

	repo := vcs.NewGitRepo(a.workspace)
	if !repo.IsInitialized() {
		writeJSON(w, http.StatusOK, []VCLogEntry{})
		return
	}

	limit := getIntQuery(r, "limit", 50)
	entries, err := repo.LogWithStats(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to get log: %v", err))
		return
	}

	result := make([]VCLogEntry, len(entries))
	for i, e := range entries {
		result[i] = VCLogEntry{
			SHA:          e.SHA,
			Subject:      e.Subject,
			Timestamp:    e.Timestamp,
			FilesChanged: e.FilesChanged,
			IsRollback:   len(e.Subject) > 9 && e.Subject[:9] == "rollback:",
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// VCSDiff handles GET /api/v1/vcs/diff/{sha}
func (a *API) VCSDiff(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}

	sha := chi.URLParam(r, "sha")
	if sha == "" {
		writeError(w, http.StatusBadRequest, "sha parameter is required")
		return
	}

	repo := vcs.NewGitRepo(a.workspace)
	diff, err := repo.Diff(sha)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to get diff: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, VCDiffResponse{
		SHA:  sha,
		Diff: diff,
	})
}

// VCSRollback handles POST /api/v1/ingest/rollback
func (a *API) VCSRollback(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}

	var payload struct {
		CommitSHA string `json:"commit_sha"`
	}
	if err := readJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if payload.CommitSHA == "" {
		writeError(w, http.StatusBadRequest, "commit_sha is required")
		return
	}

	// Verify version control is enabled
	repo := vcs.NewGitRepo(a.workspace)
	if !repo.IsInitialized() {
		writeError(w, http.StatusBadRequest, "version control is not enabled")
		return
	}

	// Verify the commit exists
	_, err := repo.ShowMessage(payload.CommitSHA)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("commit %s not found", payload.CommitSHA))
		return
	}

	// Create a rollback job
	job := &sqlite.IngestJob{
		InputType:  "rollback",
		SourcePath: "rollback://" + payload.CommitSHA,
		SourceRef:  payload.CommitSHA,
		Status:     "queued",
		MaxRetries: 1,
	}

	if err := a.db.CreateIngestJob(job); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create rollback job: %v", err))
		return
	}
	activity.Record(a.db, activity.Entry{
		Level:        "info",
		Category:     "vcs",
		Action:       "rollback_started",
		Message:      fmt.Sprintf("回滚任务已排队：%s", payload.CommitSHA),
		ResourceType: "commit",
		ResourceID:   payload.CommitSHA,
		Status:       "pending",
		Source:       "api",
		Details: map[string]interface{}{
			"commit_sha": payload.CommitSHA,
			"job_id":     job.ID,
		},
	})
	activity.LogIngestJob(a.db, job, "queued", "api")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "rollback_queued",
		"job":    job,
	})
}

// readJSON is a helper to decode JSON request body.
func readJSON(r *http.Request, v interface{}) error {
	if r.Body == nil {
		return fmt.Errorf("request body is empty")
	}
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}
