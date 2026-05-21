package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"github.com/solo-kingdom/llmwiki/internal/mcp"
)

type Pipeline struct {
	workspace   string
	llmClient   *llm.Client
	lockMgr     *PageLockManager
	recorder    JobRecorder
	mcpExecutor *pipelineMCPExecutor
	toolLoopCfg llm.ToolLoopConfig
	docLang     string // "zh" or "en", controls generation language
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

// SetJobRecorder sets the recorder for the current job execution.
func (p *Pipeline) SetJobRecorder(rec JobRecorder) {
	p.recorder = rec
}

// Recorder returns the active job recorder, if any.
func (p *Pipeline) Recorder() JobRecorder {
	return p.recorder
}

// SetMCPRouter attaches an MCP tool router for job tool-call loops.
func (p *Pipeline) SetMCPRouter(router *mcp.Router) {
	if router == nil || !router.HasJobServers() {
		p.mcpExecutor = nil
		return
	}
	p.mcpExecutor = newPipelineMCPExecutor(router)
}

// SetToolLoopConfig overrides default tool-loop limits.
func (p *Pipeline) SetToolLoopConfig(cfg llm.ToolLoopConfig) {
	p.toolLoopCfg = cfg
}

// SetDocLanguage sets the document output language for generation prompts.
func (p *Pipeline) SetDocLanguage(lang string) {
	p.docLang = lang
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

	if p.recorder != nil {
		p.recorder.Record("normalize", "complete", "source normalized", map[string]any{
			"canonical_path": source.CanonicalPath,
			"input_type":     string(source.Kind),
		})
	}

	analysis, err := p.analyze(ctx, name, content)
	if err != nil {
		if p.recorder != nil {
			p.recorder.Record("analysis", "error", err.Error(), nil)
		}
		return nil, fmt.Errorf("analysis: %w", err)
	}
	_ = analysis

	files, err := p.generate(ctx, name, content, analysis)
	if err != nil {
		if p.recorder != nil {
			p.recorder.Record("generation", "error", err.Error(), nil)
		}
		return nil, fmt.Errorf("generation: %w", err)
	}

	if p.recorder != nil {
		p.recorder.Record("apply_files", "complete", "wiki files applied", map[string]any{
			"paths_written": files,
		})
	}

	return files, nil
}

func (p *Pipeline) LockManager() *PageLockManager {
	return p.lockMgr
}

func (p *Pipeline) analyze(ctx context.Context, name, content string) (string, error) {
	langInstruction := languageInstructionForPipeline(p.docLang)
	systemMsg := "You are a knowledge analyst. Analyze the provided source document. Identify key entities, concepts, arguments, and connections."
	if langInstruction != "" {
		systemMsg += "\n\n" + langInstruction
	}
	messages := []llm.Message{
		{Role: "system", Content: systemMsg},
		{Role: "user", Content: fmt.Sprintf("Analyze this source: **%s**\n\n---\n\n%s", name, content)},
	}

	const temp = 0.1
	const maxTok = 4096
	return p.runLLMStep(ctx, "analysis", messages, temp, maxTok)
}

func (p *Pipeline) generate(ctx context.Context, name, content, analysis string) ([]string, error) {
	langInstruction := languageInstructionForPipeline(p.docLang)
	prompt := fmt.Sprintf(`Source: **%s**

Analysis (context only):
%s

Original Content:
%s

Generate wiki pages in FILE block format.`, name, analysis, content)

	systemMsg := "You are a wiki generator. Output FILE blocks: ---FILE: path\ncontent\n---END FILE---"
	if langInstruction != "" {
		systemMsg += "\n\n" + langInstruction
	}

	messages := []llm.Message{
		{Role: "system", Content: systemMsg},
		{Role: "user", Content: prompt},
	}

	const temp = 0.1
	const maxTok = 8192
	result, err := p.runLLMStep(ctx, "generation", messages, temp, maxTok)
	if err != nil {
		return nil, err
	}

	blocks := parseFileBlocksWithContent(result)

	for path := range blocks {
		p.lockMgr.Lock(path)
		p.lockMgr.Unlock(path)
	}

	return ApplyWikiBlocks(p.workspace, blocks)
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

func (p *Pipeline) runLLMStep(ctx context.Context, step string, messages []llm.Message, temp float64, maxTok int) (string, error) {
	RecordLLMRequest(p.recorder, step, p.llmClient.Model(), llmMessagesForRecord(messages), temp, maxTok)
	start := time.Now()

	cfg := p.toolLoopCfg
	if cfg.MaxRounds == 0 {
		cfg = llm.DefaultToolLoopConfig()
	}

	if p.mcpExecutor != nil && !p.mcpExecutor.LocalOnly() {
		tools, err := p.mcpExecutor.ListTools(ctx)
		if err != nil {
			p.mcpExecutor.localOnly.Store(true)
		} else if len(tools) > 0 {
			result, err := llm.RunToolLoop(ctx, p.llmClient, p.mcpExecutor, messages, tools, temp, maxTok, cfg)
			if err == nil {
				RecordLLMResponse(p.recorder, step, result, time.Since(start))
				return result, nil
			}
			if p.recorder != nil {
				p.recorder.Record(step, "warn", "tool loop failed, falling back to stream: "+err.Error(), nil)
			}
		}
	}

	ch, err := p.llmClient.StreamChat(ctx, messages, temp, maxTok)
	if err != nil {
		return "", err
	}
	var result string
	for event := range ch {
		if event.Type == "token" {
			result += event.Content
		} else if event.Type == "error" {
			if p.recorder != nil {
				p.recorder.Record(step, "error", event.Error.Error(), nil)
			}
			return "", event.Error
		}
	}
	RecordLLMResponse(p.recorder, step, result, time.Since(start))
	return result, nil
}

func llmMessagesForRecord(messages []llm.Message) []map[string]string {
	out := make([]map[string]string, len(messages))
	for i, m := range messages {
		out[i] = map[string]string{"role": m.Role, "content": m.Content}
	}
	return out
}

func computeSHA256(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h), nil
}

// languageInstructionForPipeline builds a language constraint prompt fragment.
func languageInstructionForPipeline(lang string) string {
	switch lang {
	case "zh":
		return "重要：你必须使用中文撰写所有文档正文。英文术语可以用括号注释，但不允许英文大段正文主导。文档标题、段落、说明文字必须使用中文。"
	case "en":
		return "Important: You must write all document content in English. Technical terms may include brief annotations, but no large blocks of non-English text in the main body. Titles, paragraphs, and descriptions must be in English."
	default:
		return ""
	}
}
