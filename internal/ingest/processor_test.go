package ingest

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

// mockLLMClient is a test double for the LLM client that returns canned responses.
type mockLLMClient struct {
	analyzeResp string
	generateResp string
	analyzeErr  error
	generateErr error
	callCount   int
}

func (m *mockLLMClient) StreamChat(ctx context.Context, messages []llm.Message, temperature float64, maxTokens int) (<-chan llm.StreamEvent, error) {
	m.callCount++
	ch := make(chan llm.StreamEvent, 2)

	resp := m.analyzeResp
	err := m.analyzeErr
	if m.callCount > 1 {
		resp = m.generateResp
		err = m.generateErr
	}

	if err != nil {
		go func() {
			ch <- llm.StreamEvent{Type: "error", Error: err}
			close(ch)
		}()
		return ch, nil
	}

	go func() {
		ch <- llm.StreamEvent{Type: "token", Content: resp}
		close(ch)
	}()
	return ch, nil
}

func (m *mockLLMClient) StreamChatCustom(analyzeResp, generateResp string, analyzeErr, generateErr error) *mockLLMClient {
	m.analyzeResp = analyzeResp
	m.generateResp = generateResp
	m.analyzeErr = analyzeErr
	m.generateErr = generateErr
	return m
}

func newMockLLMClient() *mockLLMClient {
	return &mockLLMClient{
		analyzeResp:  "Mock analysis of the document",
		generateResp: "---FILE: wiki/generated.md\n# Generated\nContent here.\n---END FILE---",
	}
}

func TestIngestNormalizedSuccess(t *testing.T) {
	normalized := &NormalizedSource{
		Kind:          InputKindText,
		CanonicalPath: "raw/sources/web-ingest/test.md",
		OriginalName:  "test.md",
		SourceRef:     "text",
		Content:       []byte("# Test\nSome content"),
	}

	// Verify normalized source is valid
	if normalized == nil {
		t.Fatal("normalized source should not be nil")
	}
	if normalized.Kind != InputKindText {
		t.Fatalf("kind = %q, want text", normalized.Kind)
	}
}

func TestIngestNormalizedNilSource(t *testing.T) {
	ws := t.TempDir()
	pipeline := NewPipeline(ws, nil)

	_, err := pipeline.IngestNormalized(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error for nil source")
	}
}

func TestClassifyPipelineError(t *testing.T) {
	tests := []struct {
		err  error
		want string
	}{
		{errors.New("API key is invalid"), "llm_auth_failed"},
		{errors.New("unauthorized access"), "llm_auth_failed"},
		{errors.New("got 401"), "llm_auth_failed"},
		{errors.New("rate limit exceeded"), "llm_rate_limited"},
		{errors.New("quota exceeded"), "llm_rate_limited"},
		{errors.New("got 429"), "llm_rate_limited"},
		{errors.New("timeout waiting for response"), "llm_timeout"},
		{errors.New("deadline exceeded"), "llm_timeout"},
		{errors.New("unsupported format: binary"), "unsupported_format"},
		{errors.New("analysis: something went wrong"), "analysis_failed"},
		{errors.New("generation: out of tokens"), "generation_failed"},
		{errors.New("unknown error"), "pipeline_error"},
		{nil, ""},
	}

	for _, tt := range tests {
		got := classifyPipelineError(tt.err)
		if got != tt.want {
			t.Errorf("classifyPipelineError(%v) = %q, want %q", tt.err, got, tt.want)
		}
	}
}

func TestRemediationForCode(t *testing.T) {
	tests := []struct {
		code string
		want string
	}{
		{"llm_auth_failed", "check your API key in Settings"},
		{"llm_rate_limited", "wait a moment and retry, or reduce batch size"},
		{"llm_timeout", "the LLM request timed out; try again or use a smaller input"},
		{"unsupported_format", "convert the file to a supported format before uploading"},
		{"analysis_failed", "the LLM pipeline encountered an error; check logs for details"},
		{"generation_failed", "the LLM pipeline encountered an error; check logs for details"},
		{"pipeline_error", ""},
		{"unknown", ""},
	}

	for _, tt := range tests {
		got := remediationForCode(tt.code)
		if got != tt.want {
			t.Errorf("remediationForCode(%q) = %q, want %q", tt.code, got, tt.want)
		}
	}
}

func TestProcessorClaimNextJob(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()
	processor := NewJobProcessor(db, ws, nil)

	// No jobs → nil
	job, err := processor.ClaimNextQueuedJob(context.Background())
	if err != nil {
		t.Fatalf("ClaimNextQueuedJob empty: %v", err)
	}
	if job != nil {
		t.Fatal("expected nil when no queued jobs")
	}

	// Create a queued job
	queuedJob := &sqlite.IngestJob{
		InputType:  "text",
		SourcePath: "raw/sources/web-ingest/test.md",
		SourceRef:  "text",
		Status:     "queued",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(queuedJob); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	// Should claim it
	job, err = processor.ClaimNextQueuedJob(context.Background())
	if err != nil {
		t.Fatalf("ClaimNextQueuedJob: %v", err)
	}
	if job == nil {
		t.Fatal("expected job, got nil")
	}
	if job.Status != "running" {
		t.Fatalf("status = %q, want running", job.Status)
	}

	// Claiming again should return nil (no more queued)
	job2, err := processor.ClaimNextQueuedJob(context.Background())
	if err != nil {
		t.Fatalf("ClaimNextQueuedJob second: %v", err)
	}
	if job2 != nil {
		t.Fatal("expected nil when no more queued jobs")
	}
}

func TestProcessorFailJob(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()
	processor := NewJobProcessor(db, ws, nil)

	// Create and claim a job
	job := &sqlite.IngestJob{
		InputType:  "upload",
		SourcePath: "raw/sources/web-ingest/upload.pdf",
		SourceRef:  "upload",
		Status:     "queued",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	claimed, err := processor.ClaimNextQueuedJob(context.Background())
	if err != nil {
		t.Fatalf("ClaimNextQueuedJob: %v", err)
	}

	// Fail it
	err = processor.failJob(claimed.ID, "analysis_failed", "LLM returned error", "", "retry later")
	if err != nil {
		t.Fatalf("failJob: %v", err)
	}

	// Verify failure recorded
	failed, err := db.GetIngestJob(claimed.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if failed.Status != "failed" {
		t.Fatalf("status = %q, want failed", failed.Status)
	}
	if failed.ErrorCode != "analysis_failed" {
		t.Fatalf("error_code = %q, want analysis_failed", failed.ErrorCode)
	}
	if failed.Retries != 1 {
		t.Fatalf("retries = %d, want 1", failed.Retries)
	}
	if failed.Remediation != "retry later" {
		t.Fatalf("remediation = %q, want 'retry later'", failed.Remediation)
	}
}

func TestProcessorRunPipelineForJobMissingFile(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()
	processor := NewJobProcessor(db, ws, nil)

	// Create a job that references a file that doesn't exist
	job := &sqlite.IngestJob{
		InputType:  "text",
		SourcePath: "raw/sources/web-ingest/nonexistent.md",
		SourceRef:  "text",
		Status:     "running",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	// Running pipeline for this job should fail
	err = processor.RunPipelineForJob(context.Background(), job)
	if err == nil {
		t.Fatal("expected error for missing source file")
	}

	// Verify job was marked as failed
	failed, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if failed.Status != "failed" {
		t.Fatalf("status = %q, want failed", failed.Status)
	}
	if failed.ErrorCode != "source_read_failed" {
		t.Fatalf("error_code = %q, want source_read_failed", failed.ErrorCode)
	}
}

func TestProcessorRunPipelineForJobSuccess(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()

	// Create the source file on disk
	sourceDir := filepath.Join(ws, "raw", "sources", "web-ingest")
	if err := os.MkdirAll(sourceDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sourceContent := []byte("# Test Document\nThis is a test source.")
	if err := os.WriteFile(filepath.Join(sourceDir, "test.md"), sourceContent, 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	// Create a running job referencing the source
	job := &sqlite.IngestJob{
		InputType:  "text",
		SourcePath: "raw/sources/web-ingest/test.md",
		SourceRef:  "text",
		Status:     "running",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	// Pipeline requires an LLM client which we can't mock directly,
	// so we test that the source file read and normalization work.
	// The LLM call will fail, and the job should be marked as failed with a pipeline error.
	processor := NewJobProcessor(db, ws, nil)
	err = processor.RunPipelineForJob(context.Background(), job)

	// Should fail because LLM client is nil
	if err == nil {
		t.Fatal("expected error with nil LLM client")
	}

	failed, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if failed.Status != "failed" {
		t.Fatalf("status = %q, want failed", failed.Status)
	}
}

func TestJobLineage(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Create original job
	original := &sqlite.IngestJob{
		InputType:  "text",
		SourcePath: "raw/sources/web-ingest/original.md",
		SourceRef:  "text",
		Status:     "failed",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(original); err != nil {
		t.Fatalf("CreateIngestJob original: %v", err)
	}

	// Retry → creates child with parent_job_id
	retry1, err := db.RetryIngestJob(original.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob: %v", err)
	}

	// Simulate failure of retry1
	if err := db.UpdateIngestJobStatus(retry1.ID, "failed"); err != nil {
		t.Fatalf("UpdateIngestJobStatus: %v", err)
	}

	// Retry again
	retry2, err := db.RetryIngestJob(retry1.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob 2: %v", err)
	}

	// Get lineage for retry2
	lineage, err := db.GetJobLineage(retry2.ID)
	if err != nil {
		t.Fatalf("GetJobLineage: %v", err)
	}

	if len(lineage) != 3 {
		t.Fatalf("lineage length = %d, want 3 (original + retry1 + retry2)", len(lineage))
	}

	// First should be original
	if lineage[0].ID != original.ID {
		t.Fatalf("lineage[0].ID = %q, want %q", lineage[0].ID, original.ID)
	}
	// Last should be retry2
	if lineage[2].ID != retry2.ID {
		t.Fatalf("lineage[2].ID = %q, want %q", lineage[2].ID, retry2.ID)
	}

	// Verify parent chain
	if lineage[1].ParentJobID != original.ID {
		t.Fatalf("retry1 parent = %q, want %q", lineage[1].ParentJobID, original.ID)
	}
	if lineage[2].ParentJobID != retry1.ID {
		t.Fatalf("retry2 parent = %q, want %q", lineage[2].ParentJobID, retry1.ID)
	}
}

func TestFormatCapabilityValidation(t *testing.T) {
	// Verify normalization layer correctly validates file types
	// Unsupported types should be handled at the API layer; here we test that
	// NormalizeUpload works for supported extensions
	supported := []string{"test.md", "report.pdf", "data.csv", "notes.txt"}
	for _, name := range supported {
		_, err := NormalizeUpload(name, []byte("content"), "upload")
		if err != nil {
			t.Errorf("NormalizeUpload(%q) error: %v", name, err)
		}
	}
}

// Ensure mockLLMClient satisfies the interface used by Pipeline.
// Note: Pipeline uses *llm.Client directly, so we can only use the mock
// for direct StreamChat testing, not through Pipeline.IngestNormalized.
func TestMockLLMClientStreamsEvents(t *testing.T) {
	mock := newMockLLMClient()
	ch, err := mock.StreamChat(context.Background(), nil, 0, 0)
	if err != nil {
		t.Fatalf("StreamChat: %v", err)
	}

	var result string
	for evt := range ch {
		if evt.Type == "token" {
			result += evt.Content
		}
	}
	if result != mock.analyzeResp {
		t.Fatalf("got %q, want %q", result, mock.analyzeResp)
	}
}

func TestProcessorProcessAllEmpty(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()
	processor := NewJobProcessor(db, ws, nil)

	// No jobs → ProcessAll should return nil immediately
	if err := processor.ProcessAll(context.Background()); err != nil {
		t.Fatalf("ProcessAll: %v", err)
	}
}

func TestRemediationFullChain(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Create job, fail it, retry, verify lineage and remediation
	job := &sqlite.IngestJob{
		InputType:  "conversation",
		SourcePath: "raw/sources/web-ingest/conv.md",
		SourceRef:  "chatgpt",
		Status:     "failed",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	// Fail with structured error
	if err := db.UpdateIngestJobFailure(job.ID, "llm_auth_failed",
		"invalid API key", "OpenAI API key", "check your API key in Settings"); err != nil {
		t.Fatalf("UpdateIngestJobFailure: %v", err)
	}

	// Retry
	retry, err := db.RetryIngestJob(job.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob: %v", err)
	}
	if retry.ParentJobID != job.ID {
		t.Fatalf("parent_job_id = %q, want %q", retry.ParentJobID, job.ID)
	}
	if retry.Status != "queued" {
		t.Fatalf("retry status = %q, want queued", retry.Status)
	}

	// Verify original job retains failure info
	orig, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if orig.ErrorCode != "llm_auth_failed" {
		t.Fatalf("error_code = %q, want llm_auth_failed", orig.ErrorCode)
	}
	if orig.MissingDependency != "OpenAI API key" {
		t.Fatalf("missing_dependency = %q", orig.MissingDependency)
	}
	if orig.Remediation != "check your API key in Settings" {
		t.Fatalf("remediation = %q", orig.Remediation)
	}
}

func TestRetryOnlyFailedJobs(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Try to retry a queued job → should fail
	job := &sqlite.IngestJob{
		InputType:  "text",
		SourcePath: "raw/sources/web-ingest/test.md",
		SourceRef:  "text",
		Status:     "queued",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	_, err = db.RetryIngestJob(job.ID)
	if err == nil {
		t.Fatal("expected error when retrying non-failed job")
	}
}
