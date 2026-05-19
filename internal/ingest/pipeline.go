// Package ingest provides the ingest pipeline for LLM Wiki.
package ingest

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

// Pipeline orchestrates the two-step ingest process.
type Pipeline struct {
	workspace string
	llmClient *llm.Client
}

// CacheEntry represents a cached ingest result.
type CacheEntry struct {
	SourceName  string
	SHA256      string
	WrittenFiles []string
}

// NewPipeline creates a new ingest pipeline.
func NewPipeline(workspace string, llmClient *llm.Client) *Pipeline {
	return &Pipeline{
		workspace: workspace,
		llmClient: llmClient,
	}
}

// Ingest processes a source file through the two-step pipeline.
func (p *Pipeline) Ingest(ctx context.Context, sourcePath string) ([]string, error) {
	// Step 0: Check SHA256 cache
	cached, err := p.checkCache(sourcePath)
	if err == nil && cached != nil {
		return cached.WrittenFiles, nil
	}

	// Step 0.5: Read source content
	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("read source: %w", err)
	}

	// Step 1: Analysis
	analysis, err := p.analyze(ctx, filepath.Base(sourcePath), string(content))
	if err != nil {
		return nil, fmt.Errorf("analysis: %w", err)
	}
	_ = analysis

	// Step 2: Generation
	files, err := p.generate(ctx, filepath.Base(sourcePath), string(content), analysis)
	if err != nil {
		return nil, fmt.Errorf("generation: %w", err)
	}

	// Step 3: Write files and save cache
	p.saveCache(sourcePath, files)

	return files, nil
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

	// Parse FILE blocks and write
	blocks := parseFileBlocks(result)
	return blocks, nil
}

func (p *Pipeline) checkCache(sourcePath string) (*CacheEntry, error) {
	// Stub: SHA256 cache not yet implemented
	return nil, fmt.Errorf("not cached")
}

func (p *Pipeline) saveCache(sourcePath string, files []string) {
	// Stub: cache save not yet implemented
}

func computeSHA256(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h), nil
}

// parseFileBlocks extracts FILE blocks from LLM output.
func parseFileBlocks(output string) []string {
	// Stub: FILE block parsing not yet implemented
	return nil
}
