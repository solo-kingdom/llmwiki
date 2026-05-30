package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/activity"
	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
)

// VCStatus represents the version control status response.
type VCStatus struct {
	Enabled           bool     `json:"enabled"`
	CommitCount       int      `json:"commit_count"`
	GitAvailable      bool     `json:"git_available"`
	GitVersion        string   `json:"git_version,omitempty"`
	TrackedDirs       []string `json:"tracked_dirs"`
	ExcludedDirs      []string `json:"excluded_dirs"`
	BackupDirs        []string `json:"backup_dirs"`
	RemoteConfigured  bool     `json:"remote_configured"`
	RemoteURL         string   `json:"remote_url,omitempty"`
	Branch            string   `json:"branch,omitempty"`
	Ahead             int      `json:"ahead"`
	Behind            int      `json:"behind"`
	AutoPush          bool     `json:"auto_push"`
	BackupIncludeRaw  bool     `json:"backup_include_raw"`
	LastPushError     string   `json:"last_push_error,omitempty"`
}

// VCInitResponse represents the response from VCS initialization.
type VCInitResponse struct {
	Status      string `json:"status"`
	CommitSHA   string `json:"commit_sha,omitempty"`
	CommitCount int    `json:"commit_count"`
}

// VCLogEntry represents a single commit in the log response.
type VCLogEntry struct {
	SHA          string `json:"sha"`
	Subject      string `json:"subject"`
	Timestamp    string `json:"timestamp"`
	FilesChanged int    `json:"files_changed"`
	IsRollback   bool   `json:"is_rollback"`
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

func (a *API) buildVCStatus() VCStatus {
	avail := vcs.IsGitAvailable()
	status := VCStatus{
		GitAvailable:     avail.Available,
		GitVersion:       avail.Version,
		TrackedDirs:      []string{"wiki/"},
		ExcludedDirs:     []string{".llmwiki/cache/", ".llmwiki/index.db", ".llmwiki/worktrees/", "revert/"},
		BackupDirs:       []string{"purpose.md", "rules.md", ".llmwiki/workspace-settings.json"},
		AutoPush:         false,
		BackupIncludeRaw: true,
	}
	if a.db != nil {
		status.AutoPush = a.db.VCAutoPush()
		status.BackupIncludeRaw = a.db.BackupIncludeRaw()
		status.LastPushError = a.db.GetVCLastPushError()
	}
	if status.BackupIncludeRaw {
		status.BackupDirs = append(status.BackupDirs, "raw/")
	}

	if a.workspace != "" {
		repo := vcs.NewGitRepo(a.workspace)
		if repo.IsInitialized() {
			status.Enabled = true
			if count, err := repo.CommitCount(); err == nil {
				status.CommitCount = count
			}
			if remote, err := repo.RemoteStatus(); err == nil && remote != nil {
				status.RemoteConfigured = remote.Configured
				status.RemoteURL = remote.URL
				status.Branch = remote.Branch
				status.Ahead = remote.Ahead
				status.Behind = remote.Behind
			}
		}
	}
	return status
}

// VCSStatus handles GET /api/v1/vcs/status
func (a *API) VCSStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.buildVCStatus())
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
	entries, err := repo.LogIngestOnly(limit)
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

// VCSRemote handles POST /api/v1/vcs/remote
func (a *API) VCSRemote(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}
	repo := vcs.NewGitRepo(a.workspace)
	if !repo.IsInitialized() {
		writeError(w, http.StatusBadRequest, "git repository is not initialized")
		return
	}

	var payload struct {
		URL string `json:"url"`
	}
	if err := readJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := repo.SetRemote(payload.URL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = a.db.SetVCLastPushError("")
	writeJSON(w, http.StatusOK, a.buildVCStatus())
}

// VCSPush handles POST /api/v1/vcs/push
func (a *API) VCSPush(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}
	repo := vcs.NewGitRepo(a.workspace)
	if !repo.IsInitialized() {
		writeError(w, http.StatusBadRequest, "git repository is not initialized")
		return
	}
	remote, _ := repo.RemoteStatus()
	if remote == nil || !remote.Configured {
		writeError(w, http.StatusBadRequest, "remote origin is not configured")
		return
	}
	if err := repo.Push(); err != nil {
		_ = a.db.SetVCLastPushError(err.Error())
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = a.db.SetVCLastPushError("")
	writeJSON(w, http.StatusOK, map[string]string{"status": "pushed"})
}

// VCSBackup handles POST /api/v1/vcs/backup
func (a *API) VCSBackup(w http.ResponseWriter, r *http.Request) {
	if a.workspace == "" {
		writeError(w, http.StatusBadRequest, "workspace not configured")
		return
	}
	repo := vcs.NewGitRepo(a.workspace)
	if !repo.IsInitialized() {
		writeError(w, http.StatusBadRequest, "git repository is not initialized")
		return
	}
	sha, err := a.runWorkspaceBackup()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":     "ok",
		"commit_sha": sha,
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

	repo := vcs.NewGitRepo(a.workspace)
	if !repo.IsInitialized() {
		writeError(w, http.StatusBadRequest, "git repository is not initialized")
		return
	}

	_, err := repo.ShowMessage(payload.CommitSHA)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("commit %s not found", payload.CommitSHA))
		return
	}

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
	ingest.RecordRulesSnapshot(a.db, job.ID, a.workspace)
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
