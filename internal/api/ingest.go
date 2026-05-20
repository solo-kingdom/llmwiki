package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/ingest"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

var imageSourceExtensions = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
}

var textSourceExtensions = map[string]bool{
	".md":  true,
	".txt": true,
}

type createConversationIngestRequest struct {
	Content   string `json:"content"`
	Title     string `json:"title"`
	SourceRef string `json:"source_ref"`
}

type createTextIngestRequest struct {
	Content   string `json:"content"`
	Filename  string `json:"filename"`
	Title     string `json:"title"`
	SourceRef string `json:"source_ref"`
}

type ingestJobResponse struct {
	Job *sqlite.IngestJob `json:"job"`
}

type uploadAcceptedItem struct {
	Filename   string `json:"filename"`
	JobID      string `json:"job_id"`
	Status     string `json:"status"`
	SourcePath string `json:"source_path"`
}

type uploadRejectedItem struct {
	Filename    string `json:"filename"`
	ErrorCode   string `json:"error_code"`
	Message     string `json:"message"`
	Remediation string `json:"remediation,omitempty"`
}

type uploadIngestResponse struct {
	Accepted []uploadAcceptedItem `json:"accepted"`
	Rejected []uploadRejectedItem `json:"rejected"`
}

type cancelIngestResponse struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

var supportedIngestExtensions = map[string]bool{
	".md": true, ".txt": true, ".pdf": true,
	".doc": true, ".docx": true,
	".ppt": true, ".pptx": true,
	".xls": true, ".xlsx": true,
	".csv": true, ".json": true, ".xml": true,
	".html": true, ".htm": true,
	".png": true, ".jpg": true, ".jpeg": true,
	".gif": true, ".webp": true, ".svg": true,
	".zip": true, ".rar": true, ".7z": true,
}

func (a *API) requireWorkspaceForIngest(w http.ResponseWriter) bool {
	if strings.TrimSpace(a.workspace) == "" {
		writeError(w, http.StatusServiceUnavailable, "workspace not configured for ingest")
		return false
	}
	return true
}

func (a *API) createQueuedIngestJob(inputType, sourcePath, sourceRef string) (*sqlite.IngestJob, error) {
	job := &sqlite.IngestJob{
		InputType:  inputType,
		SourcePath: sourcePath,
		SourceRef:  sourceRef,
		Status:     "queued",
		MaxRetries: 3,
	}
	if err := a.db.CreateIngestJob(job); err != nil {
		return nil, err
	}
	return job, nil
}

// CreateConversationIngestJob is the legacy one-shot ingest path (paste → job).
// Web UI primary flow uses ingest sessions + Archive; this endpoint remains for scripts/MCP compatibility.
func (a *API) CreateConversationIngestJob(w http.ResponseWriter, r *http.Request) {
	if !a.requireWorkspaceForIngest(w) {
		return
	}

	var req createConversationIngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	normalized, err := ingest.NormalizeConversation(req.Title, req.Content, req.SourceRef, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := a.writeFileBytesFirst(normalized.CanonicalPath, normalized.Content); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("persist source failed: %v", err))
		return
	}
	job, err := a.createQueuedIngestJob(string(normalized.Kind), normalized.CanonicalPath, normalized.SourceRef)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, ingestJobResponse{Job: job})
}

func (a *API) CreateTextIngestJob(w http.ResponseWriter, r *http.Request) {
	if !a.requireWorkspaceForIngest(w) {
		return
	}

	var req createTextIngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	normalized, err := ingest.NormalizeText(req.Title, req.Filename, req.Content, req.SourceRef, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := a.writeFileBytesFirst(normalized.CanonicalPath, normalized.Content); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("persist source failed: %v", err))
		return
	}

	job, err := a.createQueuedIngestJob(string(normalized.Kind), normalized.CanonicalPath, normalized.SourceRef)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, ingestJobResponse{Job: job})
}

func (a *API) CreateUploadIngestJobs(w http.ResponseWriter, r *http.Request) {
	if !a.requireWorkspaceForIngest(w) {
		return
	}

	if err := r.ParseMultipartForm(128 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		files = r.MultipartForm.File["file"]
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "no files provided")
		return
	}

	sourceRef := strings.TrimSpace(r.FormValue("source_ref"))
	if sourceRef == "" {
		sourceRef = "upload"
	}

	resp := uploadIngestResponse{
		Accepted: make([]uploadAcceptedItem, 0, len(files)),
		Rejected: make([]uploadRejectedItem, 0),
	}

	for _, fh := range files {
		name := strings.TrimSpace(fh.Filename)
		ext := strings.ToLower(filepath.Ext(name))
		if !supportedIngestExtensions[ext] {
			resp.Rejected = append(resp.Rejected, uploadRejectedItem{
				Filename:    name,
				ErrorCode:   "unsupported_file_type",
				Message:     fmt.Sprintf("unsupported file extension: %s", ext),
				Remediation: "upload a supported text, office, image, or archive file",
			})
			continue
		}

		file, err := fh.Open()
		if err != nil {
			resp.Rejected = append(resp.Rejected, uploadRejectedItem{
				Filename:  name,
				ErrorCode: "read_failed",
				Message:   err.Error(),
			})
			continue
		}

		data, readErr := io.ReadAll(file)
		file.Close()
		if readErr != nil {
			resp.Rejected = append(resp.Rejected, uploadRejectedItem{
				Filename:  name,
				ErrorCode: "read_failed",
				Message:   readErr.Error(),
			})
			continue
		}

		normalized, err := ingest.NormalizeUpload(name, data, sourceRef)
		if err != nil {
			resp.Rejected = append(resp.Rejected, uploadRejectedItem{
				Filename:  name,
				ErrorCode: "invalid_upload_input",
				Message:   err.Error(),
			})
			continue
		}

		if err := a.writeFileBytesFirst(normalized.CanonicalPath, normalized.Content); err != nil {
			resp.Rejected = append(resp.Rejected, uploadRejectedItem{
				Filename:    name,
				ErrorCode:   "persist_failed",
				Message:     err.Error(),
				Remediation: "check workspace permissions and free disk space",
			})
			continue
		}

		job, err := a.createQueuedIngestJob(string(normalized.Kind), normalized.CanonicalPath, normalized.SourceRef)
		if err != nil {
			resp.Rejected = append(resp.Rejected, uploadRejectedItem{
				Filename:  name,
				ErrorCode: "enqueue_failed",
				Message:   err.Error(),
			})
			continue
		}

		resp.Accepted = append(resp.Accepted, uploadAcceptedItem{
			Filename:   name,
			JobID:      job.ID,
			Status:     job.Status,
			SourcePath: normalized.CanonicalPath,
		})
	}

	status := http.StatusCreated
	if len(resp.Accepted) == 0 {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, resp)
}

func (a *API) GetIngestJob(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing job id")
		return
	}

	job, err := a.db.GetIngestJob(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	writeJSON(w, http.StatusOK, ingestJobResponse{Job: job})
}

func (a *API) ListIngestJobs(w http.ResponseWriter, r *http.Request) {
	limit := getIntQuery(r, "limit", 50)
	jobs, err := a.db.ListIngestJobs(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if jobs == nil {
		jobs = []sqlite.IngestJob{}
	}
	writeJSON(w, http.StatusOK, jobs)
}

func (a *API) RetryIngestJob(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing job id")
		return
	}

	retry, err := a.db.RetryIngestJob(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if retry == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	writeJSON(w, http.StatusOK, ingestJobResponse{Job: retry})
}

func (a *API) CancelIngestJob(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing job id")
		return
	}

	job, err := a.db.GetIngestJob(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	ok, err := a.db.CancelIngestJob(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ok {
		writeJSON(w, http.StatusOK, cancelIngestResponse{Status: "cancelled"})
		return
	}

	if job.Status == "running" {
		writeJSON(w, http.StatusConflict, cancelIngestResponse{
			Status:  job.Status,
			Message: "cancellation is not supported for current running stage",
		})
		return
	}

	writeJSON(w, http.StatusConflict, cancelIngestResponse{
		Status:  job.Status,
		Message: "job cannot be cancelled in current status",
	})
}

func (a *API) MarkIngestJobFailed(w http.ResponseWriter, r *http.Request) {
	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing job id")
		return
	}

	var payload struct {
		ErrorCode         string `json:"error_code"`
		Message           string `json:"message"`
		MissingDependency string `json:"missing_dependency"`
		Remediation       string `json:"remediation"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if strings.TrimSpace(payload.Message) == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	if err := a.db.UpdateIngestJobFailure(
		id,
		strings.TrimSpace(payload.ErrorCode),
		strings.TrimSpace(payload.Message),
		strings.TrimSpace(payload.MissingDependency),
		strings.TrimSpace(payload.Remediation),
	); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	job, err := a.db.GetIngestJob(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, ingestJobResponse{Job: job})
}

func (a *API) GetJobSource(w http.ResponseWriter, r *http.Request) {
	if !a.requireWorkspaceForIngest(w) {
		return
	}

	id := getID(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing job id")
		return
	}

	job, err := a.db.GetIngestJob(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job == nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	sourcePath := strings.TrimSpace(job.SourcePath)
	if sourcePath == "" {
		writeError(w, http.StatusBadRequest, "job has no source path")
		return
	}

	// Path traversal prevention
	if strings.Contains(sourcePath, "..") {
		writeError(w, http.StatusBadRequest, "source path contains invalid traversal components")
		return
	}

	absPath := filepath.Join(a.workspace, sourcePath)
	absPath = filepath.Clean(absPath)
	if !strings.HasPrefix(absPath, filepath.Clean(a.workspace)+string(filepath.Separator)) && absPath != filepath.Clean(a.workspace) {
		writeError(w, http.StatusBadRequest, "source path resolves outside workspace")
		return
	}

	ext := strings.ToLower(filepath.Ext(sourcePath))

	// Image file: return binary stream
	if contentType, ok := imageSourceExtensions[ext]; ok {
		data, err := readFileBytes(absPath)
		if err != nil {
			writeError(w, http.StatusNotFound, "source file not found")
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(http.StatusOK)
		w.Write(data)
		return
	}

	// Text file: return JSON { content, filename }
	if textSourceExtensions[ext] {
		data, err := readFileBytes(absPath)
		if err != nil {
			writeError(w, http.StatusNotFound, "source file not found")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"content":  string(data),
			"filename": filepath.Base(sourcePath),
		})
		return
	}

	writeError(w, http.StatusBadRequest, "unsupported source file type for preview")
}

func readFileBytes(path string) ([]byte, error) {
	f, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(f)
	if err != nil {
		return nil, err
	}
	return data, nil
}
