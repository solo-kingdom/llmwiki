package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

type Pipeline struct {
	workspace string
	llmClient *llm.Client
	lockMgr   *PageLockManager
}

type CacheEntry struct {
	SourceName   string   `json:"source_name"`
	SHA256       string   `json:"sha256"`
	WrittenFiles []string `json:"written_files"`
}

type cacheFile struct {
	Entries map[string]*CacheEntry `json:"entries"`
}

func NewPipeline(workspace string, llmClient *llm.Client) *Pipeline {
	return &Pipeline{
		workspace: workspace,
		llmClient: llmClient,
		lockMgr:   NewPageLockManager(),
	}
}

// SetLLMClient updates the LLM client used for subsequent pipeline runs.
func (p *Pipeline) SetLLMClient(client *llm.Client) {
	p.llmClient = client
}

func (p *Pipeline) Ingest(ctx context.Context, sourcePath string) ([]string, error) {
	cached, err := p.checkCache(sourcePath)
	if err == nil && cached != nil {
		return cached.WrittenFiles, nil
	}

	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("read source: %w", err)
	}

	normalized, err := NormalizeUpload(filepath.Base(sourcePath), content, "file")
	if err != nil {
		return nil, fmt.Errorf("normalize: %w", err)
	}

	files, err := p.IngestNormalized(ctx, normalized)
	if err != nil {
		return nil, err
	}

	p.saveCache(sourcePath, files)

	return files, nil
}

func (p *Pipeline) IngestNormalized(ctx context.Context, source *NormalizedSource) ([]string, error) {
	if source == nil {
		return nil, fmt.Errorf("normalized source is nil")
	}
	if p.llmClient == nil {
		return nil, fmt.Errorf("LLM client not configured")
	}

	name := filepath.Base(source.CanonicalPath)
	content := string(source.Content)

	analysis, err := p.analyze(ctx, name, content)
	if err != nil {
		return nil, fmt.Errorf("analysis: %w", err)
	}
	_ = analysis

	files, err := p.generate(ctx, name, content, analysis)
	if err != nil {
		return nil, fmt.Errorf("generation: %w", err)
	}

	return files, nil
}

func (p *Pipeline) LockManager() *PageLockManager {
	return p.lockMgr
}

func (p *Pipeline) analyze(ctx context.Context, name, content string) (string, error) {
	messages := []llm.Message{
		{Role: "system", Content: "You are a knowledge analyst. Analyze the provided source document. Identify key entities, concepts, arguments, and connections."},
		{Role: "user", Content: fmt.Sprintf("Analyze this source: **%s**\n\n---\n\n%s", name, content)},
	}

	ch, err := p.llmClient.StreamChat(ctx, messages, 0.1, 4096)
	if err != nil {
		return "", err
	}

	var result string
	for event := range ch {
		if event.Type == "token" {
			result += event.Content
		} else if event.Type == "error" {
			return "", event.Error
		}
	}
	return result, nil
}

func (p *Pipeline) generate(ctx context.Context, name, content, analysis string) ([]string, error) {
	prompt := fmt.Sprintf(`Source: **%s**

Analysis (context only):
%s

Original Content:
%s

Generate wiki pages in FILE block format.`, name, analysis, content)

	messages := []llm.Message{
		{Role: "system", Content: "You are a wiki generator. Output FILE blocks: ---FILE: path\ncontent\n---END FILE---"},
		{Role: "user", Content: prompt},
	}

	ch, err := p.llmClient.StreamChat(ctx, messages, 0.1, 8192)
	if err != nil {
		return nil, err
	}

	var result string
	for event := range ch {
		if event.Type == "token" {
			result += event.Content
		} else if event.Type == "error" {
			return nil, event.Error
		}
	}

	blocks := parseFileBlocks(result)

	for _, f := range blocks {
		p.lockMgr.Lock(f)
		p.lockMgr.Unlock(f)
	}

	return blocks, nil
}

func (p *Pipeline) cachePath() string {
	return filepath.Join(p.workspace, ".llmwiki", "cache.json")
}

func (p *Pipeline) checkCache(sourcePath string) (*CacheEntry, error) {
	hash, err := computeSHA256(sourcePath)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(p.cachePath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("not cached")
		}
		return nil, err
	}

	var cf cacheFile
	if err := json.Unmarshal(data, &cf); err != nil {
		return nil, err
	}

	absPath, err := filepath.Abs(sourcePath)
	if err != nil {
		absPath = sourcePath
	}

	entry, ok := cf.Entries[absPath]
	if !ok {
		return nil, fmt.Errorf("not cached")
	}

	if entry.SHA256 == hash {
		return entry, nil
	}

	return nil, fmt.Errorf("cache miss: hash changed")
}

func (p *Pipeline) saveCache(sourcePath string, files []string) {
	hash, err := computeSHA256(sourcePath)
	if err != nil {
		return
	}

	absPath, err := filepath.Abs(sourcePath)
	if err != nil {
		absPath = sourcePath
	}

	dir := filepath.Join(p.workspace, ".llmwiki")
	os.MkdirAll(dir, 0o755)

	var cf cacheFile
	data, err := os.ReadFile(p.cachePath())
	if err == nil {
		json.Unmarshal(data, &cf)
	}
	if cf.Entries == nil {
		cf.Entries = make(map[string]*CacheEntry)
	}

	cf.Entries[absPath] = &CacheEntry{
		SourceName:   filepath.Base(sourcePath),
		SHA256:       hash,
		WrittenFiles: files,
	}

	out, err := json.MarshalIndent(cf, "", "  ")
	if err != nil {
		return
	}
	os.WriteFile(p.cachePath(), out, 0o644)
}

func computeSHA256(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h), nil
}

var fileBlockRe = regexp.MustCompile(`(?s)---FILE:\s*(.+?)\n(.*?)---END FILE---`)

func parseFileBlocks(output string) []string {
	matches := fileBlockRe.FindAllStringSubmatch(output, -1)
	var files []string
	for _, m := range matches {
		path := strings.TrimSpace(m[1])
		if path != "" {
			files = append(files, path)
		}
	}
	return files
}
