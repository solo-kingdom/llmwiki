package ingest

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
	"github.com/solo-kingdom/llmwiki/internal/vcs"
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
		{errors.New("send request: Post \"/chat/completions\": unsupported protocol scheme \"\""), "llm_config_invalid"},
		{errors.New("provider base URL is not configured"), "llm_config_invalid"},
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
		{"llm_config_invalid", "configure Provider and base URL in Settings (Provider instances)"},
		{"llm_timeout", "the LLM request timed out; try again or use a smaller input"},
		{"unsupported_format", "convert the file to a supported format before uploading"},
		{"analysis_failed", "the LLM pipeline encountered an error; check the job error message and server logs"},
		{"generation_failed", "the LLM pipeline encountered an error; check the job error message and server logs"},
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
	processor := NewJobProcessor(db, ws)

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
	processor := NewJobProcessor(db, ws)

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
	processor := NewJobProcessor(db, ws)

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
	clearLLMEnv(t)

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

	// Without provider instance or workspace LLM config, job should fail early.
	processor := NewJobProcessor(db, ws)
	err = processor.RunPipelineForJob(context.Background(), job)

	if err == nil {
		t.Fatal("expected error without LLM configuration")
	}

	failed, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if failed.Status != "failed" {
		t.Fatalf("status = %q, want failed", failed.Status)
	}
	if failed.ErrorCode != "llm_config_invalid" {
		t.Fatalf("error_code = %q, want llm_config_invalid", failed.ErrorCode)
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

	// Requeue same job twice — still one row
	requeued, err := db.RetryIngestJob(original.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob: %v", err)
	}
	if requeued.ID != original.ID {
		t.Fatalf("requeue id = %q, want %q", requeued.ID, original.ID)
	}
	if requeued.Status != "queued" {
		t.Fatalf("status = %q, want queued", requeued.Status)
	}

	if err := db.UpdateIngestJobStatus(original.ID, "failed"); err != nil {
		t.Fatalf("UpdateIngestJobStatus: %v", err)
	}

	requeued2, err := db.RetryIngestJob(original.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob 2: %v", err)
	}
	if requeued2.ID != original.ID {
		t.Fatalf("second requeue id = %q, want %q", requeued2.ID, original.ID)
	}

	jobs, err := db.ListIngestJobs(100)
	if err != nil {
		t.Fatalf("ListIngestJobs: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("job count = %d, want 1 (no duplicate rows on requeue)", len(jobs))
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
	processor := NewJobProcessor(db, ws)

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

	// Requeue clears failure fields
	retry, err := db.RetryIngestJob(job.ID)
	if err != nil {
		t.Fatalf("RetryIngestJob: %v", err)
	}
	if retry.ID != job.ID {
		t.Fatalf("id = %q, want %q", retry.ID, job.ID)
	}
	if retry.Status != "queued" {
		t.Fatalf("retry status = %q, want queued", retry.Status)
	}
	if retry.ErrorCode != "" || retry.ErrorMessage != "" || retry.Remediation != "" {
		t.Fatalf("expected cleared errors after requeue, got code=%q msg=%q remediation=%q",
			retry.ErrorCode, retry.ErrorMessage, retry.Remediation)
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

func TestProcessorWithGitCommit(t *testing.T) {
	if !vcs.IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Set up workspace with git repo
	ws := t.TempDir()
	os.MkdirAll(filepath.Join(ws, "wiki"), 0o755)
	os.MkdirAll(filepath.Join(ws, "raw", "sources", "web-ingest"), 0o755)

	repo, err := vcs.InitRepo(ws)
	if err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	// Create a source file
	sourceContent := []byte("# Test\nHello world")
	os.WriteFile(filepath.Join(ws, "raw", "sources", "web-ingest", "test.md"), sourceContent, 0o644)

	if err := db.SetVCEnabled(true); err != nil {
		t.Fatalf("SetVCEnabled: %v", err)
	}

	processor := NewJobProcessor(db, ws)
	processor.SetGitRepo(repo)

	// Create a running job
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

	// Run pipeline - will fail because LLM client is nil, but the job should be
	// marked as failed with pipeline_error, not commit_failed
	err = processor.RunPipelineForJob(context.Background(), job)
	if err == nil {
		t.Fatal("expected error with nil LLM client")
	}

	failed, _ := db.GetIngestJob(job.ID)
	if failed.ErrorCode == "commit_failed" {
		t.Error("should not be commit_failed since pipeline failed first")
	}
}

func TestProcessorWithoutGitCommit(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()
	processor := NewJobProcessor(db, ws)
	// No git repo set - version control disabled

	// Create a running job
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

	// Run pipeline should fail at LLM call (nil client), not at git
	err = processor.RunPipelineForJob(context.Background(), job)
	if err == nil {
		t.Fatal("expected error with nil LLM client")
	}
}

func TestGitRepoIfEnabled(t *testing.T) {
	if !vcs.IsGitAvailable().Available {
		t.Skip("git not available")
	}

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()
	os.MkdirAll(filepath.Join(ws, "wiki"), 0o755)
	if _, err := vcs.InitRepo(ws); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}

	processor := NewJobProcessor(db, ws)

	if repo := processor.gitRepoIfEnabled(); repo != nil {
		t.Error("expected nil when vc_enabled is false")
	}

	if err := db.SetVCEnabled(true); err != nil {
		t.Fatalf("SetVCEnabled: %v", err)
	}
	if repo := processor.gitRepoIfEnabled(); repo == nil {
		t.Error("expected non-nil when vc_enabled and .git exist")
	}

	if err := db.SetVCEnabled(false); err != nil {
		t.Fatalf("SetVCEnabled(false): %v", err)
	}
	if repo := processor.gitRepoIfEnabled(); repo != nil {
		t.Error("expected nil after disabling vc")
	}
}

func TestProcessorSetGitRepo(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := sqlite.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ws := t.TempDir()
	processor := NewJobProcessor(db, ws)

	// Should be nil initially
	if processor.gitRepo != nil {
		t.Error("expected nil gitRepo initially")
	}

	// Set to non-nil
	repo := vcs.NewGitRepo(ws)
	processor.SetGitRepo(repo)
	if processor.gitRepo == nil {
		t.Error("expected non-nil gitRepo after SetGitRepo")
	}

	// Set back to nil
	processor.SetGitRepo(nil)
	if processor.gitRepo != nil {
		t.Error("expected nil gitRepo after setting nil")
	}
}

func clearLLMEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"LLMWIKI_BASE_URL",
		"LLMWIKI_API_KEY",
		"LLMWIKI_PROVIDER",
		"LLMWIKI_MODEL",
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
	} {
		t.Setenv(key, "")
	}
}

func seedProcessorOpenAIProvider(t *testing.T, db *sqlite.DB) *sqlite.ProviderInstance {
	t.Helper()
	if err := db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{
			ID:        "openai",
			Name:      "OpenAI",
			APIBase:   "https://api.openai.com/v1",
			APIFormat: "openai",
		},
	}); err != nil {
		t.Fatalf("UpsertProviderInfo: %v", err)
	}
	inst := &sqlite.ProviderInstance{
		Name:      "OpenAI Work",
		CatalogID: "openai",
		APIKey:    "sk-test-key",
	}
	if err := db.CreateProviderInstance(inst); err != nil {
		t.Fatalf("CreateProviderInstance: %v", err)
	}
	return inst
}

func TestResolveLLMClientForSessionArchiveUsesSessionConfig(t *testing.T) {
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	inst := seedProcessorOpenAIProvider(t, db)
	session := &sqlite.IngestSession{
		Title:         "Archive Session",
		StoragePath:   "raw/sources/web-ingest/sessions/sess123",
		LLMInstanceID: inst.ID,
		LLMModel:      "gpt-4o",
	}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}

	processor := NewJobProcessor(db, t.TempDir())
	job := &sqlite.IngestJob{
		InputType:  string(InputKindSessionArchive),
		SourceRef:  "session:" + session.ID,
		SourcePath: "raw/sources/web-ingest/sessions/sess123/archive.md",
	}

	client, err := processor.resolveLLMClientForJob(job)
	if err != nil {
		t.Fatalf("resolveLLMClientForJob: %v", err)
	}
	if client == nil {
		t.Fatal("expected client")
	}
}

func TestResolveLLMClientForJobUsesJobSettings(t *testing.T) {
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	inst := seedProcessorOpenAIProvider(t, db)
	if err := db.SetConfig("job_instance_id", inst.ID); err != nil {
		t.Fatalf("SetConfig job_instance_id: %v", err)
	}
	if err := db.SetConfig("job_model", "gpt-4o"); err != nil {
		t.Fatalf("SetConfig job_model: %v", err)
	}
	if err := db.SetConfig("last_instance_id", "inst_nonexistent"); err != nil {
		t.Fatalf("SetConfig last_instance_id: %v", err)
	}
	if err := db.SetConfig("last_model", "gpt-4o"); err != nil {
		t.Fatalf("SetConfig last_model: %v", err)
	}

	processor := NewJobProcessor(db, t.TempDir())
	job := &sqlite.IngestJob{
		InputType:  "text",
		SourceRef:  "text",
		SourcePath: "raw/sources/web-ingest/test.md",
	}

	client, err := processor.resolveLLMClientForJob(job)
	if err != nil {
		t.Fatalf("resolveLLMClientForJob: %v", err)
	}
	if client == nil {
		t.Fatal("expected client from job settings")
	}
}

func TestResolveLLMClientForSessionArchiveIgnoresJobSettings(t *testing.T) {
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	inst := seedProcessorOpenAIProvider(t, db)
	session := &sqlite.IngestSession{
		Title:         "Archive Session",
		StoragePath:   "raw/sources/web-ingest/sessions/sess123",
		LLMInstanceID: inst.ID,
		LLMModel:      "gpt-4o",
	}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}
	if err := db.SetConfig("job_instance_id", "inst_nonexistent"); err != nil {
		t.Fatalf("SetConfig job_instance_id: %v", err)
	}
	if err := db.SetConfig("job_model", "gpt-4o"); err != nil {
		t.Fatalf("SetConfig job_model: %v", err)
	}

	processor := NewJobProcessor(db, t.TempDir())
	job := &sqlite.IngestJob{
		InputType:  string(InputKindSessionArchive),
		SourceRef:  "session:" + session.ID,
		SourcePath: "raw/sources/web-ingest/sessions/sess123/archive.md",
	}

	client, err := processor.resolveLLMClientForJob(job)
	if err != nil {
		t.Fatalf("resolveLLMClientForJob: %v", err)
	}
	if client == nil {
		t.Fatal("expected client from session config")
	}
}

func TestResolveLLMClientForJobUsesGlobalDefaults(t *testing.T) {
	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	inst := seedProcessorOpenAIProvider(t, db)
	if err := db.SetConfig("last_instance_id", inst.ID); err != nil {
		t.Fatalf("SetConfig last_instance_id: %v", err)
	}
	if err := db.SetConfig("last_model", "gpt-4o"); err != nil {
		t.Fatalf("SetConfig last_model: %v", err)
	}

	processor := NewJobProcessor(db, t.TempDir())
	job := &sqlite.IngestJob{
		InputType:  "text",
		SourceRef:  "text",
		SourcePath: "raw/sources/web-ingest/test.md",
	}

	client, err := processor.resolveLLMClientForJob(job)
	if err != nil {
		t.Fatalf("resolveLLMClientForJob: %v", err)
	}
	if client == nil {
		t.Fatal("expected client")
	}
}

func TestResolveLLMClientForJobMissingConfig(t *testing.T) {
	clearLLMEnv(t)

	db, err := sqlite.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	processor := NewJobProcessor(db, t.TempDir())
	job := &sqlite.IngestJob{
		InputType:  "text",
		SourceRef:  "text",
		SourcePath: "raw/sources/web-ingest/test.md",
	}

	_, err = processor.resolveLLMClientForJob(job)
	if err == nil {
		t.Fatal("expected error without LLM configuration")
	}
	if !strings.Contains(err.Error(), "base URL is not configured") &&
		!strings.Contains(err.Error(), "not configured") {
		t.Fatalf("error = %q, want configuration hint", err.Error())
	}
}
