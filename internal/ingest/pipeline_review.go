package ingest

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

// PlanOnly runs analysis + plan generation without writing wiki files.
func (p *Pipeline) PlanOnly(ctx context.Context, source *NormalizedSource, feedback string) (*PlanResult, error) {
	if source == nil {
		return nil, fmt.Errorf("normalized source is nil")
	}
	if p.llmClient == nil {
		return nil, fmt.Errorf("LLM client not configured")
	}

	name := filepath.Base(source.CanonicalPath)
	content := string(source.Content)

	if p.recorder != nil {
		p.recorder.Record("plan", "start", "generating review plan", map[string]any{
			"canonical_path": source.CanonicalPath,
		})
	}

	analysis, err := p.analyze(ctx, name, content)
	if err != nil {
		if p.recorder != nil {
			p.recorder.Record("plan", "error", err.Error(), nil)
		}
		return nil, fmt.Errorf("analysis: %w", err)
	}

	planRaw, err := p.generatePlan(ctx, name, content, analysis, feedback)
	if err != nil {
		if p.recorder != nil {
			p.recorder.Record("plan", "error", err.Error(), nil)
		}
		return nil, fmt.Errorf("plan: %w", err)
	}

	result, err := ParsePlanResult(planRaw)
	if err != nil {
		return nil, err
	}

	if p.recorder != nil {
		p.recorder.Record("plan", "complete", "review plan generated", map[string]any{
			"plan_chars": len(result.PlanMarkdown),
		})
	}
	return result, nil
}

// ApplyFromPlan regenerates FILE blocks from an approved plan and writes wiki files.
func (p *Pipeline) ApplyFromPlan(ctx context.Context, source *NormalizedSource, planJSON string) ([]string, error) {
	if source == nil {
		return nil, fmt.Errorf("normalized source is nil")
	}
	if p.llmClient == nil {
		return nil, fmt.Errorf("LLM client not configured")
	}
	planJSON = strings.TrimSpace(planJSON)
	if planJSON == "" {
		return nil, fmt.Errorf("approved plan is empty")
	}

	name := filepath.Base(source.CanonicalPath)
	content := string(source.Content)

	if p.recorder != nil {
		p.recorder.Record("apply", "start", "regenerating FILE blocks from approved plan", nil)
	}

	analysis, err := p.analyze(ctx, name, content)
	if err != nil {
		return nil, fmt.Errorf("analysis: %w", err)
	}

	files, err := p.generateFromPlan(ctx, name, content, analysis, planJSON)
	if err != nil {
		if p.recorder != nil {
			p.recorder.Record("apply", "error", err.Error(), nil)
		}
		return nil, fmt.Errorf("generation: %w", err)
	}

	if p.recorder != nil {
		p.recorder.Record("apply_files", "complete", "wiki files applied from approved plan", map[string]any{
			"paths_written": files,
		})
	}
	return files, nil
}

func (p *Pipeline) generatePlan(ctx context.Context, name, content, analysis, feedback string) (string, error) {
	// Detect session mode from archive content
	planStep := StepPlan
	if mode := ParseSessionModeFromArchive(content); mode != "" {
		switch mode {
		case "organize":
			planStep = StepPlanOrganize
		case "qa":
			planStep = StepPlanQA
		}
	}
	systemMsg := ComposeSystemPrompt(planStep, p.promptCtx())

	userParts := []string{
		fmt.Sprintf("源文件：**%s**\n\n分析：\n%s\n\n原始内容：\n%s", name, analysis, content),
	}
	if strings.TrimSpace(feedback) != "" {
		userParts = append(userParts, feedback)
	}

	messages := []llm.Message{
		{Role: "system", Content: systemMsg},
		{Role: "user", Content: strings.Join(userParts, "\n\n---\n\n")},
	}
	return p.runLLMStep(ctx, "plan", messages, 0.2, 4096)
}

func (p *Pipeline) generateFromPlan(ctx context.Context, name, content, analysis, planJSON string) ([]string, error) {
	prompt := fmt.Sprintf(`源文件：**%s**

已批准计划（必须遵循 — 仅据此重新生成 FILE 块）：
%s

分析（参考）：
%s

原始内容：
%s

请按 FILE 块格式生成 wiki 页面。`, name, planJSON, analysis, content)

	systemMsg := ComposeSystemPrompt(StepGeneration, p.promptCtx())

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
	return ApplyWikiBlocks(ctx, p.workspace, blocks, p.applyWikiBlocksOpts())
}

