package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

type testCreateRequest struct {
	Filename   string   `json:"filename"`
	Path       string   `json:"path"`
	Content    string   `json:"content"`
	Title      string   `json:"title"`
	SourceKind string   `json:"source_kind"`
	Tags       []string `json:"tags"`
}

func setupTestAPI(t *testing.T) (*API, *chi.Mux) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	api := New(db)
	api.SetWorkspace(dir)
	r := chi.NewRouter()

	r.Get("/api/v1/health", api.Health)
	r.Get("/api/v1/documents", api.ListDocuments)
	r.Post("/api/v1/documents", api.CreateDocument)
	r.Route("/api/v1/documents/{id}", func(r chi.Router) {
		r.Get("/", api.GetDocument)
		r.Put("/content", api.UpdateDocumentContent)
		r.Delete("/", api.DeleteDocument)
	})
	r.Get("/api/v1/search", api.Search)
	r.Route("/api/v1/graph", func(r chi.Router) {
		r.Get("/uncited", api.UncitedSources)
		r.Get("/stale", api.StalePages)
		r.Get("/{id}/backlinks", api.Backlinks)
		r.Get("/{id}/forward", api.ForwardReferences)
	})
	r.Route("/api/v1/ingest/jobs", func(r chi.Router) {
		r.Get("/", api.ListIngestJobs)
		r.Get("/{id}", api.GetIngestJob)
		r.Get("/{id}/source", api.GetJobSource)
		r.Post("/{id}/retry", api.RetryIngestJob)
		r.Post("/{id}/cancel", api.CancelIngestJob)
		r.Post("/{id}/fail", api.MarkIngestJobFailed)
		r.Post("/conversation", api.CreateConversationIngestJob)
		r.Post("/text", api.CreateTextIngestJob)
		r.Post("/upload", api.CreateUploadIngestJobs)
	})

	return api, r
}

func (a *API) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func TestHealthEndpoint(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["status"] != "ok" {
		t.Errorf("expected status ok, got %q", resp["status"])
	}
}

func TestListDocumentsEmpty(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
}

func TestCreateAndGetDocument(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "test.md",
		Path:     "/wiki",
		Content:  "# Hello World",
		Title:    "Test",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d; body: %s", w.Code, w.Body.String())
	}

	var created sqlite.Document
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.Filename != "test.md" {
		t.Errorf("expected filename 'test.md', got %q", created.Filename)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+created.ID, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", getW.Code)
	}

	var fetched sqlite.Document
	if err := json.NewDecoder(getW.Body).Decode(&fetched); err != nil {
		t.Fatalf("decode fetched: %v", err)
	}
	if fetched.Filename != "test.md" {
		t.Errorf("expected filename 'test.md', got %q", fetched.Filename)
	}
}

func TestCreateDocumentMissingFilename(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Content: "some content",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestUpdateDocumentContent(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "update.md",
		Path:     "/wiki",
		Content:  "original",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var created sqlite.Document
	json.NewDecoder(w.Body).Decode(&created)

	updateBody, _ := json.Marshal(updateContentRequest{Content: "updated content"})
	upReq := httptest.NewRequest(http.MethodPut, "/api/v1/documents/"+created.ID+"/content", bytes.NewReader(updateBody))
	upReq.Header.Set("Content-Type", "application/json")
	upW := httptest.NewRecorder()
	r.ServeHTTP(upW, upReq)

	if upW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d; body: %s", upW.Code, upW.Body.String())
	}
}

func TestDeleteDocument(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "delete-me.md",
		Path:     "/wiki",
		Content:  "to be deleted",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var created sqlite.Document
	json.NewDecoder(w.Body).Decode(&created)

	delReq := httptest.NewRequest(http.MethodDelete, "/api/v1/documents/"+created.ID, nil)
	delW := httptest.NewRecorder()
	r.ServeHTTP(delW, delReq)

	if delW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", delW.Code)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+created.ID, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusNotFound {
		t.Errorf("expected status 404 after delete, got %d", getW.Code)
	}
}

func TestGetDocumentNotFound(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/nonexistent-id", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestSearchEndpoint(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "searchable.md",
		Path:     "/wiki",
		Content:  "Machine learning and neural networks",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	searchReq := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=machine+learning&limit=5", nil)
	searchW := httptest.NewRecorder()
	r.ServeHTTP(searchW, searchReq)

	if searchW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d; body: %s", searchW.Code, searchW.Body.String())
	}
}

func TestSearchMissingQuery(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestGraphEndpoints(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(testCreateRequest{
		Filename: "graph-test.md",
		Path:     "/wiki",
		Content:  "test",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/documents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var created sqlite.Document
	json.NewDecoder(w.Body).Decode(&created)

	blReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/"+created.ID+"/backlinks", nil)
	blW := httptest.NewRecorder()
	r.ServeHTTP(blW, blReq)
	if blW.Code != http.StatusOK {
		t.Errorf("backlinks: expected status 200, got %d", blW.Code)
	}

	fwdReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/"+created.ID+"/forward", nil)
	fwdW := httptest.NewRecorder()
	r.ServeHTTP(fwdW, fwdReq)
	if fwdW.Code != http.StatusOK {
		t.Errorf("forward refs: expected status 200, got %d", fwdW.Code)
	}

	uncitedReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/uncited", nil)
	uncitedW := httptest.NewRecorder()
	r.ServeHTTP(uncitedW, uncitedReq)
	if uncitedW.Code != http.StatusOK {
		t.Errorf("uncited: expected status 200, got %d", uncitedW.Code)
	}

	staleReq := httptest.NewRequest(http.MethodGet, "/api/v1/graph/stale", nil)
	staleW := httptest.NewRecorder()
	r.ServeHTTP(staleW, staleReq)
	if staleW.Code != http.StatusOK {
		t.Errorf("stale: expected status 200, got %d", staleW.Code)
	}
}

func TestCreateTextIngestJobAndGet(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(map[string]interface{}{
		"content": "hello from text ingest",
		"title":   "My Text",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d; body=%s", w.Code, w.Body.String())
	}

	var created ingestJobResponse
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Job == nil || created.Job.ID == "" {
		t.Fatal("expected created job with ID")
	}
	if created.Job.Status != "queued" {
		t.Fatalf("expected queued status, got %q", created.Job.Status)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/"+created.Job.ID, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", getW.Code)
	}
}

func TestRetryAndCancelIngestJob(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(map[string]interface{}{
		"content": "hello",
		"title":   "Retry Case",
	})
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createW := httptest.NewRecorder()
	r.ServeHTTP(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("create status = %d", createW.Code)
	}

	var created ingestJobResponse
	_ = json.NewDecoder(createW.Body).Decode(&created)

	failBody, _ := json.Marshal(map[string]interface{}{
		"error_code": "missing_dependency",
		"message":    "pdftotext missing",
	})
	failReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+created.Job.ID+"/fail", bytes.NewReader(failBody))
	failReq.Header.Set("Content-Type", "application/json")
	failW := httptest.NewRecorder()
	r.ServeHTTP(failW, failReq)
	if failW.Code != http.StatusOK {
		t.Fatalf("fail status = %d, body=%s", failW.Code, failW.Body.String())
	}

	retryReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+created.Job.ID+"/retry", nil)
	retryW := httptest.NewRecorder()
	r.ServeHTTP(retryW, retryReq)
	if retryW.Code != http.StatusOK {
		t.Fatalf("retry status = %d, body=%s", retryW.Code, retryW.Body.String())
	}

	var retryResp ingestJobResponse
	_ = json.NewDecoder(retryW.Body).Decode(&retryResp)
	if retryResp.Job == nil || retryResp.Job.ID != created.Job.ID {
		t.Fatalf("expected requeued same job id %s, got %+v", created.Job.ID, retryResp.Job)
	}
	if retryResp.Job.Status != "queued" {
		t.Fatalf("retry status = %q, want queued", retryResp.Job.Status)
	}

	cancelReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+created.Job.ID+"/cancel", nil)
	cancelW := httptest.NewRecorder()
	r.ServeHTTP(cancelW, cancelReq)
	if cancelW.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, body=%s", cancelW.Code, cancelW.Body.String())
	}
}

func TestUploadIngestJobsAcceptedRejected(t *testing.T) {
	_, r := setupTestAPI(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	good, _ := writer.CreateFormFile("files", "notes.md")
	_, _ = good.Write([]byte("# notes"))

	bad, _ := writer.CreateFormFile("files", "malware.exe")
	_, _ = bad.Write([]byte("MZ"))

	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp uploadIngestResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode upload response: %v", err)
	}
	if len(resp.Accepted) != 1 {
		t.Fatalf("accepted=%d, want 1", len(resp.Accepted))
	}
	if len(resp.Rejected) != 1 {
		t.Fatalf("rejected=%d, want 1", len(resp.Rejected))
	}
}

func TestIngestRequiresWorkspace(t *testing.T) {
	// Setup API without workspace to validate persistence precondition.
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	api := New(db)
	r := chi.NewRouter()
	r.Post("/api/v1/ingest/jobs/text", api.CreateTextIngestJob)

	body, _ := json.Marshal(map[string]interface{}{
		"content": "hello",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestIngestConversationMissingContent(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(map[string]interface{}{
		"title": "test",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/conversation", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestIngestTextMissingContent(t *testing.T) {
	_, r := setupTestAPI(t)

	body, _ := json.Marshal(map[string]interface{}{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestIngestUploadNoFiles(t *testing.T) {
	_, r := setupTestAPI(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestIngestRetryCancelledJob(t *testing.T) {
	_, r := setupTestAPI(t)

	// Create a text ingest job (status=queued)
	body, _ := json.Marshal(map[string]interface{}{
		"content":  "test content",
		"filename": "test.md",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d", w.Code)
	}

	var createResp ingestJobResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	jobID := createResp.Job.ID

	// Cancel the queued job
	cancelReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+jobID+"/cancel", nil)
	cancelW := httptest.NewRecorder()
	r.ServeHTTP(cancelW, cancelReq)
	if cancelW.Code != http.StatusOK {
		t.Fatalf("cancel: expected 200, got %d; body=%s", cancelW.Code, cancelW.Body.String())
	}

	// Retry the cancelled job — should succeed (Restart flow)
	retryReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+jobID+"/retry", nil)
	retryW := httptest.NewRecorder()
	r.ServeHTTP(retryW, retryReq)

	if retryW.Code != http.StatusOK {
		t.Fatalf("retry cancelled job: expected 200, got %d; body=%s", retryW.Code, retryW.Body.String())
	}

	var retryResp ingestJobResponse
	json.NewDecoder(retryW.Body).Decode(&retryResp)
	if retryResp.Job == nil {
		t.Fatal("expected requeued job in response")
	}
	if retryResp.Job.ID != jobID {
		t.Fatalf("job id = %q, want same %q", retryResp.Job.ID, jobID)
	}
	if retryResp.Job.Status != "queued" {
		t.Fatalf("retry status = %q, want queued", retryResp.Job.Status)
	}
}

func TestIngestRetryNonFailedJob(t *testing.T) {
	api, r := setupTestAPI(t)

	// Create a text ingest job (status=queued)
	body, _ := json.Marshal(map[string]interface{}{
		"content":  "test content",
		"filename": "test.md",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d", w.Code)
	}

	var createResp ingestJobResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	jobID := createResp.Job.ID

	// Try to retry a queued job — should fail with 400
	retryReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+jobID+"/retry", nil)
	retryW := httptest.NewRecorder()
	r.ServeHTTP(retryW, retryReq)

	if retryW.Code != http.StatusBadRequest {
		t.Fatalf("retry queued job: expected 400, got %d; body=%s", retryW.Code, retryW.Body.String())
	}

	// Mark the job as succeeded (via direct DB update) and verify retry still returns 400
	if err := api.db.UpdateIngestJobStatus(jobID, "succeeded"); err != nil {
		t.Fatalf("update status: %v", err)
	}
	retryReq2 := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+jobID+"/retry", nil)
	retryW2 := httptest.NewRecorder()
	r.ServeHTTP(retryW2, retryReq2)
	if retryW2.Code != http.StatusBadRequest {
		t.Fatalf("retry succeeded job: expected 400, got %d; body=%s", retryW2.Code, retryW2.Body.String())
	}
}

func TestIngestCancelNonExistentJob(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/nonexistent-id/cancel", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestIngestListJobsEmpty(t *testing.T) {
	_, r := setupTestAPI(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var jobs []interface{}
	json.NewDecoder(w.Body).Decode(&jobs)
	if jobs == nil {
		t.Fatal("expected empty array, got nil")
	}
}

// --- Task 7.1: E2E acceptance tests (conversation/text/upload three entry points) ---

func TestE2EConversationIngestLifecycle(t *testing.T) {
	_, r := setupTestAPI(t)

	// 1. Create conversation ingest
	body, _ := json.Marshal(map[string]interface{}{
		"content":    "This is a conversation about AI safety.",
		"title":      "AI Safety Discussion",
		"source_ref": "chatgpt",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/conversation", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create conversation: expected 201, got %d; body=%s", w.Code, w.Body.String())
	}

	var createResp ingestJobResponse
	if err := json.NewDecoder(w.Body).Decode(&createResp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	jobID := createResp.Job.ID
	if createResp.Job.Status != "queued" {
		t.Fatalf("status = %q, want queued", createResp.Job.Status)
	}
	if createResp.Job.InputType != "conversation" {
		t.Fatalf("input_type = %q, want conversation", createResp.Job.InputType)
	}

	// 2. Get job status
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/"+jobID, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("get job: expected 200, got %d", getW.Code)
	}

	// 3. List jobs should include the new job
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/", nil)
	listW := httptest.NewRecorder()
	r.ServeHTTP(listW, listReq)

	if listW.Code != http.StatusOK {
		t.Fatalf("list jobs: expected 200, got %d", listW.Code)
	}

	var jobs []sqlite.IngestJob
	json.NewDecoder(listW.Body).Decode(&jobs)
	if len(jobs) == 0 {
		t.Fatal("expected at least 1 job in list")
	}

	// 4. Cancel the job
	cancelReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+jobID+"/cancel", nil)
	cancelW := httptest.NewRecorder()
	r.ServeHTTP(cancelW, cancelReq)

	if cancelW.Code != http.StatusOK {
		t.Fatalf("cancel: expected 200, got %d; body=%s", cancelW.Code, cancelW.Body.String())
	}
}

func TestE2ETextIngestFullFlow(t *testing.T) {
	_, r := setupTestAPI(t)

	// 1. Create text ingest
	body, _ := json.Marshal(map[string]interface{}{
		"content":    "# Notes\nThese are my research notes.",
		"filename":   "research-notes.md",
		"title":      "Research Notes",
		"source_ref": "manual",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create text: expected 201, got %d; body=%s", w.Code, w.Body.String())
	}

	var createResp ingestJobResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	if createResp.Job.InputType != "text" {
		t.Fatalf("input_type = %q, want text", createResp.Job.InputType)
	}

	// 2. Mark as failed (simulating pipeline error)
	failBody, _ := json.Marshal(map[string]interface{}{
		"error_code":   "llm_auth_failed",
		"message":      "Invalid API key",
		"missing_dependency": "OpenAI API key",
		"remediation":  "check your API key in Settings",
	})
	failReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+createResp.Job.ID+"/fail", bytes.NewReader(failBody))
	failReq.Header.Set("Content-Type", "application/json")
	failW := httptest.NewRecorder()
	r.ServeHTTP(failW, failReq)

	if failW.Code != http.StatusOK {
		t.Fatalf("fail: expected 200, got %d; body=%s", failW.Code, failW.Body.String())
	}

	// 3. Retry the failed job
	retryReq := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/"+createResp.Job.ID+"/retry", nil)
	retryW := httptest.NewRecorder()
	r.ServeHTTP(retryW, retryReq)

	if retryW.Code != http.StatusOK {
		t.Fatalf("retry: expected 200, got %d; body=%s", retryW.Code, retryW.Body.String())
	}

	var retryResp ingestJobResponse
	json.NewDecoder(retryW.Body).Decode(&retryResp)
	if retryResp.Job.ID != createResp.Job.ID {
		t.Fatalf("job id = %q, want same %q", retryResp.Job.ID, createResp.Job.ID)
	}
	if retryResp.Job.Status != "queued" {
		t.Fatalf("retry status = %q, want queued", retryResp.Job.Status)
	}
	if retryResp.Job.ErrorCode != "" || retryResp.Job.ErrorMessage != "" {
		t.Fatalf("expected cleared errors after requeue, got code=%q msg=%q",
			retryResp.Job.ErrorCode, retryResp.Job.ErrorMessage)
	}
}

func TestE2EUploadIngestPartialSuccess(t *testing.T) {
	_, r := setupTestAPI(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	// Write 3 files: 2 supported + 1 unsupported
	for _, f := range []struct {
		name    string
		content string
	}{
		{"document.md", "# Markdown doc"},
		{"data.csv", "name,value\nfoo,1"},
		{"malware.exe", "MZ binary"},
	} {
		part, _ := writer.CreateFormFile("files", f.name)
		part.Write([]byte(f.content))
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("upload: expected 201, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp uploadIngestResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if len(resp.Accepted) != 2 {
		t.Fatalf("accepted = %d, want 2; accepted=%+v", len(resp.Accepted), resp.Accepted)
	}
	if len(resp.Rejected) != 1 {
		t.Fatalf("rejected = %d, want 1; rejected=%+v", len(resp.Rejected), resp.Rejected)
	}
	if resp.Rejected[0].ErrorCode != "unsupported_file_type" {
		t.Fatalf("rejected error_code = %q, want unsupported_file_type", resp.Rejected[0].ErrorCode)
	}

	// All accepted should have job IDs
	for _, a := range resp.Accepted {
		if a.JobID == "" {
			t.Errorf("accepted file %q has empty job_id", a.Filename)
		}
		if a.Status != "queued" {
			t.Errorf("accepted file %q status = %q, want queued", a.Filename, a.Status)
		}
	}
}

func TestGetJobSourceTextFile(t *testing.T) {
	api, r := setupTestAPI(t)

	// Create a text ingest job first
	body, _ := json.Marshal(map[string]interface{}{
		"content":  "initial content",
		"filename": "original.md",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d", w.Code)
	}

	var createResp ingestJobResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	jobID := createResp.Job.ID

	// Now create our test file and update the job's source_path to point to it
	sourceDir := filepath.Join(api.workspace, "raw", "sources", "preview")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	sourceContent := "# Test Document\n\nHello world from source."
	if err := os.WriteFile(filepath.Join(sourceDir, "test.md"), []byte(sourceContent), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	// Manually set source_path to point to our test file
	api.db.DB().Exec(`UPDATE ingest_jobs SET source_path = ? WHERE id = ?`, "raw/sources/preview/test.md", jobID)

	// Get source content
	srcReq := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/"+jobID+"/source", nil)
	srcW := httptest.NewRecorder()
	r.ServeHTTP(srcW, srcReq)

	if srcW.Code != http.StatusOK {
		t.Fatalf("get source: expected 200, got %d; body=%s", srcW.Code, srcW.Body.String())
	}

	var srcResp map[string]string
	json.NewDecoder(srcW.Body).Decode(&srcResp)
	if srcResp["content"] != sourceContent {
		t.Fatalf("content = %q, want %q", srcResp["content"], sourceContent)
	}
	if srcResp["filename"] != "test.md" {
		t.Fatalf("filename = %q, want test.md", srcResp["filename"])
	}
}

func TestGetJobSourceImageFile(t *testing.T) {
	api, r := setupTestAPI(t)

	// Create workspace source directory and a fake image file
	sourceDir := filepath.Join(api.workspace, "raw", "sources")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	imageData := []byte{0x89, 0x50, 0x4E, 0x47} // PNG magic bytes
	if err := os.WriteFile(filepath.Join(sourceDir, "test.png"), imageData, 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	// Create a text ingest job to get a valid job ID
	body, _ := json.Marshal(map[string]interface{}{
		"content":  "hello",
		"filename": "test.md",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp ingestJobResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	jobID := createResp.Job.ID

	// Set source_path to the image
	api.db.DB().Exec(`UPDATE ingest_jobs SET source_path = ? WHERE id = ?`, "raw/sources/test.png", jobID)

	srcReq := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/"+jobID+"/source", nil)
	srcW := httptest.NewRecorder()
	r.ServeHTTP(srcW, srcReq)

	if srcW.Code != http.StatusOK {
		t.Fatalf("get source: expected 200, got %d; body=%s", srcW.Code, srcW.Body.String())
	}
	ct := srcW.Header().Get("Content-Type")
	if ct != "image/png" {
		t.Fatalf("content-type = %q, want image/png", ct)
	}
}

func TestGetJobSourceNotFound(t *testing.T) {
	_, r := setupTestAPI(t)

	// Request source for non-existent job
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/nonexistent-id/source", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetJobSourceFileNotFoundOnDisk(t *testing.T) {
	api, r := setupTestAPI(t)

	// Create a text ingest job
	body, _ := json.Marshal(map[string]interface{}{
		"content":  "hello",
		"filename": "test.md",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp ingestJobResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	jobID := createResp.Job.ID

	// Set source_path to a file that doesn't exist
	api.db.DB().Exec(`UPDATE ingest_jobs SET source_path = ? WHERE id = ?`, "raw/sources/nonexistent.md", jobID)

	srcReq := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/"+jobID+"/source", nil)
	srcW := httptest.NewRecorder()
	r.ServeHTTP(srcW, srcReq)

	if srcW.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body=%s", srcW.Code, srcW.Body.String())
	}
}

func TestGetJobSourcePathTraversal(t *testing.T) {
	api, r := setupTestAPI(t)

	// Create a text ingest job
	body, _ := json.Marshal(map[string]interface{}{
		"content":  "hello",
		"filename": "test.md",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var createResp ingestJobResponse
	json.NewDecoder(w.Body).Decode(&createResp)
	jobID := createResp.Job.ID

	// Set source_path with path traversal
	api.db.DB().Exec(`UPDATE ingest_jobs SET source_path = ? WHERE id = ?`, "../../../etc/passwd", jobID)

	srcReq := httptest.NewRequest(http.MethodGet, "/api/v1/ingest/jobs/"+jobID+"/source", nil)
	srcW := httptest.NewRecorder()
	r.ServeHTTP(srcW, srcReq)

	if srcW.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path traversal, got %d; body=%s", srcW.Code, srcW.Body.String())
	}
}

// --- Task 7.2: Boundary tests (large file + batch upload) ---

func TestIngestUploadAllUnsupported(t *testing.T) {
	_, r := setupTestAPI(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	for _, name := range []string{"a.exe", "b.sh", "c.mp4"} {
		part, _ := writer.CreateFormFile("files", name)
		part.Write([]byte("content"))
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// All rejected → 400
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body=%s", w.Code, w.Body.String())
	}

	var resp uploadIngestResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if len(resp.Accepted) != 0 {
		t.Fatalf("accepted = %d, want 0", len(resp.Accepted))
	}
	if len(resp.Rejected) != 3 {
		t.Fatalf("rejected = %d, want 3", len(resp.Rejected))
	}
}

func TestIngestUploadEmptyFileAccepted(t *testing.T) {
	_, r := setupTestAPI(t)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	// Empty .md file (0 bytes content — still accepted, normalization may fail later)
	part, _ := writer.CreateFormFile("files", "empty.md")
	part.Write([]byte{})
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/jobs/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Empty file will be rejected by NormalizeUpload (content required)
	var resp uploadIngestResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if len(resp.Rejected) != 1 {
		t.Fatalf("expected 1 rejected for empty file, got rejected=%d accepted=%d",
			len(resp.Rejected), len(resp.Accepted))
	}
}
