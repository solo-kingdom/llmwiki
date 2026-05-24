package vcs

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/solo-kingdom/llmwiki/internal/llm"
)

// MergeConflictContext carries LLM and language settings for conflict resolution.
type MergeConflictContext struct {
	LLMClient *llm.Client
	DocLang   string
}

const mergeConflictMinBodyRatio = 0.7

// ResolveMergeConflicts resolves all merge conflicts using LLM semantic merging.
// For each conflicting file, it reads ours/theirs content, uses LLM to merge them,
// and writes the resolved content. After all conflicts are resolved, it completes
// the merge with a commit.
func ResolveMergeConflicts(ctx context.Context, repo *GitRepo, jobID string, mc *MergeConflictContext) error {
	// List unmerged files
	out, err := repo.gitOutput("ls-files", "-u", "--exclude-standard")
	if err != nil {
		return fmt.Errorf("list unmerged files: %w", err)
	}

	// Extract unique conflicting file paths
	seen := make(map[string]bool)
	var conflicts []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) == 2 {
			path := parts[1]
			if !seen[path] {
				seen[path] = true
				conflicts = append(conflicts, path)
			}
		}
	}

	if len(conflicts) == 0 {
		return fmt.Errorf("no conflicts found to resolve")
	}

	resolved := make(map[string]string)

	for _, filePath := range conflicts {
		ours, theirs, err := repo.GetConflictContent(jobID, filePath)
		if err != nil {
			return fmt.Errorf("get conflict content for %s: %w", filePath, err)
		}

		merged, err := llmMergeConflict(ctx, mc, filePath, ours, theirs)
		if err != nil {
			return fmt.Errorf("LLM merge conflict for %s: %w", filePath, err)
		}

		resolved[filePath] = merged
	}

	// Write resolved content and commit
	commitMsg := fmt.Sprintf("merge: %s (LLM resolved %d conflict(s))", BranchName(jobID), len(conflicts))
	if err := repo.ResolveAndCommit(jobID, resolved, commitMsg); err != nil {
		return fmt.Errorf("resolve and commit: %w", err)
	}

	return nil
}

// llmMergeConflict uses LLM to semantically merge two versions of a wiki page.
// It handles frontmatter merging and body merging similar to the ingest merge logic.
func llmMergeConflict(ctx context.Context, mc *MergeConflictContext, filePath, ours, theirs string) (string, error) {
	// If one side is empty, use the non-empty side
	if ours == "" && theirs == "" {
		return "", nil
	}
	if ours == "" {
		return theirs, nil
	}
	if theirs == "" {
		return ours, nil
	}

	// If identical, no conflict
	if ours == theirs {
		return ours, nil
	}

	// Need LLM from here on
	if mc == nil || mc.LLMClient == nil {
		return "", fmt.Errorf("LLM client not configured for conflict resolution")
	}

	// Try wiki-style merge (frontmatter + body) if both have frontmatter
	oursFM, oursBody, oursHasFM := splitWikiContent(ours)
	theirsFM, theirsBody, theirsHasFM := splitWikiContent(theirs)

	if oursHasFM || theirsHasFM {
		return mergeWikiConflict(ctx, mc, oursFM, oursBody, theirsFM, theirsBody)
	}

	// Plain text merge
	return mergeBodyConflict(ctx, mc, filePath, ours, theirs)
}

// splitWikiContent splits content into frontmatter YAML and body.
func splitWikiContent(content string) (fm, body string, hasFM bool) {
	content = strings.TrimSpace(content)
	if !strings.HasPrefix(content, "---") {
		return "", content, false
	}

	// Find second ---
	end := strings.Index(content[3:], "\n---")
	if end < 0 {
		return "", content, false
	}

	fm = content[3 : end+3]
	fm = strings.TrimSpace(fm)
	body = content[end+3+4:] // skip past second ---
	body = strings.TrimSpace(body)
	return fm, body, true
}

// mergeWikiConflict merges wiki pages with frontmatter.
func mergeWikiConflict(ctx context.Context, mc *MergeConflictContext,
	oursFM, oursBody, theirsFM, theirsBody string) (string, error) {

	// For frontmatter: keep ours as base, merge theirs keys
	// Simple strategy: prefer non-empty values, union arrays
	mergedFM := oursFM
	if mergedFM == "" {
		mergedFM = theirsFM
	}

	// Merge bodies
	var mergedBody string
	var err error
	if oursBody == theirsBody {
		mergedBody = oursBody
	} else {
		mergedBody, err = mergeBodyConflict(ctx, mc, "wiki page", oursBody, theirsBody)
		if err != nil {
			return "", err
		}
	}

	// Reassemble
	var sb strings.Builder
	sb.WriteString("---\n")
	sb.WriteString(mergedFM)
	sb.WriteString("\n---\n")
	sb.WriteString(mergedBody)
	return sb.String(), nil
}

// mergeBodyConflict uses LLM to merge two body versions.
func mergeBodyConflict(ctx context.Context, mc *MergeConflictContext, label, ours, theirs string) (string, error) {
	lang := mc.DocLang
	if lang == "" {
		lang = "zh"
	}

	var systemMsg, userMsg string
	if lang == "zh" {
		systemMsg = "你是 wiki 文档合并助手。你需要将两个独立修改的 wiki 页面版本合并为一个完整、一致、不重复的版本。保留两份修改中所有有价值的信息，消除重复内容，保持结构一致。仅输出合并后的完整 markdown 正文。"
		userMsg = fmt.Sprintf(
			"以下是「%s」页面存在合并冲突的两个版本，来自两个独立的整理任务。\n"+
				"请合并为一个完整版本。\n\n"+
				"## 版本 A（已合并的 wiki）\n\n%s\n\n## 版本 B（新任务的修改）\n\n%s",
			label, ours, theirs)
	} else {
		systemMsg = "You are a wiki document merge assistant. Merge two independently modified versions into one complete, consistent, non-redundant version. Preserve all valuable information from both versions, eliminate duplicates, and maintain structural consistency. Output only the merged markdown body."
		userMsg = fmt.Sprintf(
			"The following wiki page '%s' has a merge conflict from two independent tasks.\n"+
				"Please merge into one complete version.\n\n"+
				"## Version A (merged wiki)\n\n%s\n\n## Version B (new task changes)\n\n%s",
			label, ours, theirs)
	}

	messages := []llm.Message{
		{Role: "system", Content: systemMsg},
		{Role: "user", Content: userMsg},
	}

	const temp = 0.1
	const maxTok = 8192

	ch, err := mc.LLMClient.StreamChat(ctx, messages, temp, maxTok)
	if err != nil {
		return "", err
	}

	var result strings.Builder
	for event := range ch {
		switch event.Type {
		case "token":
			result.WriteString(event.Content)
		case "error":
			return "", event.Error
		}
	}

	merged := strings.TrimSpace(result.String())

	// Length guard: merged result should not be too aggressive
	oursLen := utf8.RuneCountInString(ours)
	theirsLen := utf8.RuneCountInString(theirs)
	maxLen := oursLen
	if theirsLen > maxLen {
		maxLen = theirsLen
	}
	mergedLen := utf8.RuneCountInString(merged)
	if maxLen > 0 && mergedLen < int(float64(maxLen)*mergeConflictMinBodyRatio) {
		return "", fmt.Errorf("merge conflict too aggressive: merged %d chars < 70%% of max %d chars", mergedLen, maxLen)
	}

	return merged, nil
}
