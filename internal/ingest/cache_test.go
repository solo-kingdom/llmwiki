package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func openAIStreamChunk(content string) string {
	b, _ := json.Marshal(map[string]interface{}{
		"choices": []map[string]interface{}{
			{"delta": map[string]string{"content": content}},
		},
	})
	return string(b)
}

func newCountingLLMClient(t *testing.T, responses ...string) (*llm.Client, *atomic.Int32, string) {
	t.Helper()
	var callCount atomic.Int32
	var idx atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		i := int(idx.Add(1)) - 1
		resp := "mock analysis"
		if i < len(responses) {
			resp = responses[i]
		} else if len(responses) > 0 {
			resp = responses[len(responses)-1]
		}

		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", openAIStreamChunk(resp))
		fmt.Fprintf(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)

	baseURL := srv.URL + "/v1"
	client := llm.NewClient(llm.Config{
		Provider: "openai",
		BaseURL:  baseURL,
		Model:    "test-model",
	})
	return client, &callCount, baseURL
}

func seedCacheEntry(t *testing.T, workspace string, key string, entry *CacheEntry) {
	t.Helper()
	dir := filepath.Join(workspace, ".llmwiki")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir cache dir: %v", err)
	}

	cf := cacheFile{Entries: map[string]*CacheEntry{key: entry}}
	out, err := json.MarshalIndent(cf, "", "  ")
	if err != nil {
		t.Fatalf("marshal cache: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cache.json"), out, 0o644); err != nil {
		t.Fatalf("write cache: %v", err)
	}
}

func writeWikiFile(t *testing.T, workspace, rel, content string) {
	t.Helper()
	full := filepath.Join(workspace, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir wiki: %v", err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write wiki: %v", err)
	}
}

func TestIngestNormalizedCacheHitSkipsLLM(t *testing.T) {
	ws := t.TempDir()
	content := []byte("# Test\nCached content")
	source := &NormalizedSource{
		Kind:          InputKindText,
		CanonicalPath: "raw/sources/web-ingest/test.md",
		OriginalName:  "test.md",
		SourceRef:     "text",
		Content:       content,
	}

	writeWikiFile(t, ws, "wiki/cached.md", "# Cached")
	hash := contentSHA256(content)
	seedCacheEntry(t, ws, cacheKeyForNormalized(source), &CacheEntry{
		SourceName:    "test.md",
		SHA256:        hash,
		ContentSHA256: hash,
		WrittenFiles:  []string{"wiki/cached.md"},
	})

	client, calls, _ := newCountingLLMClient(t, "should not be called")
	pipeline := NewPipeline(ws, client)

	files, err := pipeline.IngestNormalized(context.Background(), source)
	if err != nil {
		t.Fatalf("IngestNormalized: %v", err)
	}
	if len(files) != 1 || files[0] != "wiki/cached.md" {
		t.Fatalf("files = %v, want [wiki/cached.md]", files)
	}
	if calls.Load() != 0 {
		t.Fatalf("LLM call count = %d, want 0", calls.Load())
	}
}

func TestIngestNormalizedCacheMissOnContentChange(t *testing.T) {
	ws := t.TempDir()
	oldContent := []byte("# Old\nPrevious content")
	source := &NormalizedSource{
		Kind:          InputKindText,
		CanonicalPath: "raw/sources/web-ingest/test.md",
		OriginalName:  "test.md",
		SourceRef:     "text",
		Content:       []byte("# Changed\nNew content"),
	}

	oldHash := contentSHA256(oldContent)
	writeWikiFile(t, ws, "wiki/stale.md", "# Stale")
	oldKey := source.CanonicalPath + "|" + oldHash
	seedCacheEntry(t, ws, oldKey, &CacheEntry{
		SourceName:    "test.md",
		SHA256:        oldHash,
		ContentSHA256: oldHash,
		WrittenFiles:  []string{"wiki/stale.md"},
	})

	generateResp := "---FILE: wiki/generated.md\n# Generated\nFresh content.\n---END FILE---"
	client, calls, _ := newCountingLLMClient(t, "analysis result", generateResp)
	pipeline := NewPipeline(ws, client)

	files, err := pipeline.IngestNormalized(context.Background(), source)
	if err != nil {
		t.Fatalf("IngestNormalized: %v", err)
	}
	if len(files) != 1 || files[0] != "wiki/generated.md" {
		t.Fatalf("files = %v, want [wiki/generated.md]", files)
	}
	if calls.Load() != 2 {
		t.Fatalf("LLM call count = %d, want 2 (analysis + generation)", calls.Load())
	}
}

func TestIngestNormalizedCacheMissWhenWrittenFilesMissing(t *testing.T) {
	ws := t.TempDir()
	content := []byte("# Test\nCached content")
	source := &NormalizedSource{
		Kind:          InputKindText,
		CanonicalPath: "raw/sources/web-ingest/test.md",
		OriginalName:  "test.md",
		SourceRef:     "text",
		Content:       content,
	}

	hash := contentSHA256(content)
	seedCacheEntry(t, ws, cacheKeyForNormalized(source), &CacheEntry{
		SourceName:    "test.md",
		SHA256:        hash,
		ContentSHA256: hash,
		WrittenFiles:  []string{"wiki/missing.md"},
	})

	generateResp := "---FILE: wiki/regenerated.md\n# Regenerated\nContent.\n---END FILE---"
	client, calls, _ := newCountingLLMClient(t, "analysis result", generateResp)
	pipeline := NewPipeline(ws, client)

	files, err := pipeline.IngestNormalized(context.Background(), source)
	if err != nil {
		t.Fatalf("IngestNormalized: %v", err)
	}
	if len(files) != 1 || files[0] != "wiki/regenerated.md" {
		t.Fatalf("files = %v, want [wiki/regenerated.md]", files)
	}
	if calls.Load() != 2 {
		t.Fatalf("LLM call count = %d, want 2", calls.Load())
	}
}

func TestLegacyCacheLookupByAbsPath(t *testing.T) {
	ws := t.TempDir()
	sourcePath := filepath.Join(ws, "raw", "sources", "legacy.md")
	if err := os.MkdirAll(filepath.Dir(sourcePath), 0o755); err != nil {
		t.Fatalf("mkdir source: %v", err)
	}
	content := []byte("# Legacy\nOld cache format")
	if err := os.WriteFile(sourcePath, content, 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	hash := contentSHA256(content)
	writeWikiFile(t, ws, "wiki/legacy.md", "# Legacy Wiki")
	seedCacheEntry(t, ws, sourcePath, &CacheEntry{
		SourceName:   "legacy.md",
		SHA256:       hash,
		WrittenFiles: []string{"wiki/legacy.md"},
	})

	client, calls, _ := newCountingLLMClient(t, "should not be called")
	pipeline := NewPipeline(ws, client)

	files, err := pipeline.Ingest(context.Background(), sourcePath)
	if err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if len(files) != 1 || files[0] != "wiki/legacy.md" {
		t.Fatalf("files = %v, want [wiki/legacy.md]", files)
	}
	if calls.Load() != 0 {
		t.Fatalf("LLM call count = %d, want 0", calls.Load())
	}
}

func TestCacheHitRecordsEvent(t *testing.T) {
	ws := t.TempDir()
	content := []byte("# Test\nCached content")
	source := &NormalizedSource{
		Kind:          InputKindText,
		CanonicalPath: "raw/sources/web-ingest/test.md",
		OriginalName:  "test.md",
		SourceRef:     "text",
		Content:       content,
	}

	writeWikiFile(t, ws, "wiki/cached.md", "# Cached")
	hash := contentSHA256(content)
	seedCacheEntry(t, ws, cacheKeyForNormalized(source), &CacheEntry{
		SourceName:    "test.md",
		SHA256:        hash,
		ContentSHA256: hash,
		WrittenFiles:  []string{"wiki/cached.md"},
	})

	rec := &mockJobRecorder{}
	client, _, _ := newCountingLLMClient(t)
	pipeline := NewPipeline(ws, client)
	pipeline.SetJobRecorder(rec)

	if _, err := pipeline.IngestNormalized(context.Background(), source); err != nil {
		t.Fatalf("IngestNormalized: %v", err)
	}

	found := false
	for _, ev := range rec.events {
		if ev.step == "cache" && ev.phase == "hit" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected cache hit recorder event")
	}
}

func seedProcessorOpenAIProviderWithBase(t *testing.T, db *sqlite.DB, apiBase string) *sqlite.ProviderInstance {
	t.Helper()
	if err := db.UpsertProviderInfo([]sqlite.ProviderInfo{
		{
			ID:        "openai",
			Name:      "OpenAI",
			APIBase:   apiBase,
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

func setupProcessorCacheHitTest(t *testing.T, inputType, sourcePath, sourceRef string, content []byte) (*JobProcessor, *sqlite.DB, *sqlite.IngestJob, *atomic.Int32) {
	t.Helper()

	db, err := sqlite.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	ws := t.TempDir()
	fullSource := filepath.Join(ws, sourcePath)
	if err := os.MkdirAll(filepath.Dir(fullSource), 0o755); err != nil {
		t.Fatalf("mkdir source dir: %v", err)
	}
	if err := os.WriteFile(fullSource, content, 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	normalized := &NormalizedSource{
		Kind:          InputKind(inputType),
		CanonicalPath: sourcePath,
		OriginalName:  filepath.Base(sourcePath),
		SourceRef:     sourceRef,
		Content:       content,
	}
	if inputType == string(InputKindSessionArchive) {
		normalized.Kind = InputKindSessionArchive
	} else if inputType == "upload" {
		normalized.Kind = InputKindUpload
	} else if inputType == "text" {
		normalized.Kind = InputKindText
	}

	writeWikiFile(t, ws, "wiki/cached-job.md", "# Cached Job")
	hash := contentSHA256(content)
	seedCacheEntry(t, ws, cacheKeyForNormalized(normalized), &CacheEntry{
		SourceName:    filepath.Base(sourcePath),
		SHA256:        hash,
		ContentSHA256: hash,
		WrittenFiles:  []string{"wiki/cached-job.md"},
	})

	client, calls, baseURL := newCountingLLMClient(t, "should not be called")
	inst := seedProcessorOpenAIProviderWithBase(t, db, baseURL)
	if err := db.SetConfig("job_instance_id", inst.ID); err != nil {
		t.Fatalf("SetConfig job_instance_id: %v", err)
	}
	if err := db.SetConfig("job_model", "gpt-4o"); err != nil {
		t.Fatalf("SetConfig job_model: %v", err)
	}

	processor := NewJobProcessor(db, ws)
	_ = client

	job := &sqlite.IngestJob{
		InputType:  inputType,
		SourcePath: sourcePath,
		SourceRef:  sourceRef,
		Status:     "running",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	return processor, db, job, calls
}

func TestProcessorCacheHitTextJob(t *testing.T) {
	content := []byte("# Text Job\nCached content")
	sourcePath := "raw/sources/web-ingest/text-job.md"
	processor, db, job, calls := setupProcessorCacheHitTest(t, "text", sourcePath, "text", content)

	if err := processor.RunPipelineForJob(context.Background(), job); err != nil {
		t.Fatalf("RunPipelineForJob: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("LLM call count = %d, want 0", calls.Load())
	}

	updated, err := db.GetIngestJob(job.ID)
	if err != nil {
		t.Fatalf("GetIngestJob: %v", err)
	}
	if updated.Status != "succeeded" {
		t.Fatalf("status = %q, want succeeded", updated.Status)
	}
}

func TestProcessorCacheHitUploadJob(t *testing.T) {
	content := []byte("# Upload Job\nCached content")
	sourcePath := "raw/sources/web-ingest/upload-job.md"
	processor, _, job, calls := setupProcessorCacheHitTest(t, "upload", sourcePath, "upload", content)

	if err := processor.RunPipelineForJob(context.Background(), job); err != nil {
		t.Fatalf("RunPipelineForJob: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("LLM call count = %d, want 0", calls.Load())
	}
}

func TestProcessorCacheHitSessionArchiveJob(t *testing.T) {
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	ws := t.TempDir()
	content := []byte("# Session Archive\nCached content")
	sourcePath := "raw/sources/web-ingest/sessions/sess123/archive.md"
	fullSource := filepath.Join(ws, sourcePath)
	if err := os.MkdirAll(filepath.Dir(fullSource), 0o755); err != nil {
		t.Fatalf("mkdir source dir: %v", err)
	}
	if err := os.WriteFile(fullSource, content, 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	_, calls, baseURL := newCountingLLMClient(t, "should not be called")
	inst := seedProcessorOpenAIProviderWithBase(t, db, baseURL)
	session := &sqlite.IngestSession{
		Title:         "Archive Session",
		StoragePath:   "raw/sources/web-ingest/sessions/sess123",
		LLMInstanceID: inst.ID,
		LLMModel:      "gpt-4o",
	}
	if err := db.CreateIngestSession(session); err != nil {
		t.Fatalf("CreateIngestSession: %v", err)
	}

	normalized := &NormalizedSource{
		Kind:          InputKindSessionArchive,
		CanonicalPath: sourcePath,
		OriginalName:  "archive.md",
		SourceRef:     "session:" + session.ID,
		Content:       content,
	}
	writeWikiFile(t, ws, "wiki/cached-job.md", "# Cached Job")
	hash := contentSHA256(content)
	seedCacheEntry(t, ws, cacheKeyForNormalized(normalized), &CacheEntry{
		SourceName:    "archive.md",
		SHA256:        hash,
		ContentSHA256: hash,
		WrittenFiles:  []string{"wiki/cached-job.md"},
	})

	processor := NewJobProcessor(db, ws)

	job := &sqlite.IngestJob{
		InputType:  string(InputKindSessionArchive),
		SourcePath: sourcePath,
		SourceRef:  "session:" + session.ID,
		Status:     "running",
		MaxRetries: 3,
	}
	if err := db.CreateIngestJob(job); err != nil {
		t.Fatalf("CreateIngestJob: %v", err)
	}

	if err := processor.RunPipelineForJob(context.Background(), job); err != nil {
		t.Fatalf("RunPipelineForJob: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("LLM call count = %d, want 0", calls.Load())
	}
}

func TestSaveCacheUsesNewKeyFormat(t *testing.T) {
	ws := t.TempDir()
	source := &NormalizedSource{
		Kind:          InputKindText,
		CanonicalPath: "raw/sources/web-ingest/save-key.md",
		OriginalName:  "save-key.md",
		SourceRef:     "text",
		Content:       []byte("# Save\nContent"),
	}

	generateResp := "---FILE: wiki/saved.md\n# Saved\nContent.\n---END FILE---"
	client, _, _ := newCountingLLMClient(t, "analysis", generateResp)
	pipeline := NewPipeline(ws, client)

	if _, err := pipeline.IngestNormalized(context.Background(), source); err != nil {
		t.Fatalf("IngestNormalized: %v", err)
	}

	wantKey := cacheKeyForNormalized(source)
	data, err := os.ReadFile(filepath.Join(ws, ".llmwiki", "cache.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if !strings.Contains(string(data), wantKey) {
		t.Fatalf("cache.json missing new key %q:\n%s", wantKey, string(data))
	}
}
