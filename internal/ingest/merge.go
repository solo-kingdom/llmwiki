package ingest

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/solo-kingdom/llmwiki/internal/llm"
	"gopkg.in/yaml.v3"
)

const mergeMinBodyRatio = 0.7

var wikiFrontmatterRe = regexp.MustCompile(`(?s)\A---[ \t]*\n(.+?\n)---[ \t]*\n(.*)\z`)

var (
	lockedFrontmatterKeys = []string{"type", "title", "created"}
	unionFrontmatterKeys  = []string{"tags", "sources", "related"}
	preferNewIfSetKeys    = []string{"date", "description"}
)

// MergeContext carries LLM and language settings for page body merge.
type MergeContext struct {
	LLMClient *llm.Client
	DocLang   string
	Recorder  JobRecorder
}

// ApplyWikiBlocksOpts configures wiki file application behavior.
type ApplyWikiBlocksOpts struct {
	ForceOverwrite bool
	Merge          *MergeContext
}

func splitWikiPage(content string) (fmYAML, body string, hasFM bool) {
	m := wikiFrontmatterRe.FindStringSubmatch(content)
	if len(m) < 3 {
		return "", content, false
	}
	return m[1], m[2], true
}

func joinWikiPage(fmYAML, body string) string {
	if fmYAML == "" {
		return body
	}
	return "---\n" + strings.TrimSuffix(fmYAML, "\n") + "\n---\n" + body
}

func parseYAMLMap(yamlText string) map[string]interface{} {
	yamlText = strings.TrimSpace(yamlText)
	if yamlText == "" {
		return map[string]interface{}{}
	}
	var out map[string]interface{}
	if err := yaml.Unmarshal([]byte(yamlText), &out); err != nil || out == nil {
		return map[string]interface{}{}
	}
	return out
}

func marshalYAMLMap(m map[string]interface{}) (string, error) {
	if len(m) == 0 {
		return "", nil
	}
	b, err := yaml.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func isEmptyYAMLValue(v interface{}) bool {
	if v == nil {
		return true
	}
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x) == ""
	case []interface{}:
		return len(x) == 0
	case []string:
		return len(x) == 0
	default:
		return false
	}
}

func stringSliceFromYAML(v interface{}) []string {
	switch x := v.(type) {
	case nil:
		return nil
	case []string:
		return append([]string(nil), x...)
	case []interface{}:
		var out []string
		for _, item := range x {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		if strings.TrimSpace(x) != "" {
			return []string{x}
		}
	}
	return nil
}

func unionStringSlices(a, b []string) []string {
	seen := make(map[string]struct{}, len(a)+len(b))
	var out []string
	for _, slice := range [][]string{a, b} {
		for _, s := range slice {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if _, ok := seen[s]; ok {
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	if out == nil {
		return []string{}
	}
	return out
}

// mergeFrontmatter merges YAML frontmatter maps per design rules.
func mergeFrontmatter(oldYAML, newYAML string) (string, error) {
	oldMap := parseYAMLMap(oldYAML)
	newMap := parseYAMLMap(newYAML)

	out := make(map[string]interface{})
	for k, v := range oldMap {
		out[k] = v
	}
	for k, v := range newMap {
		out[k] = v
	}

	for _, k := range lockedFrontmatterKeys {
		if v, ok := oldMap[k]; ok && !isEmptyYAMLValue(v) {
			out[k] = v
		}
	}

	for _, k := range unionFrontmatterKeys {
		out[k] = unionStringSlices(stringSliceFromYAML(oldMap[k]), stringSliceFromYAML(newMap[k]))
	}

	for _, k := range preferNewIfSetKeys {
		if v, ok := newMap[k]; ok && !isEmptyYAMLValue(v) {
			out[k] = v
		} else if v, ok := oldMap[k]; ok {
			out[k] = v
		}
	}

	return marshalYAMLMap(out)
}

func mergeBodyLLM(ctx context.Context, mc *MergeContext, oldBody, newBody string) (string, error) {
	if mc == nil || mc.LLMClient == nil {
		return "", fmt.Errorf("LLM client not configured for body merge")
	}
	if oldBody == newBody {
		return oldBody, nil
	}

	oldLen := utf8.RuneCountInString(oldBody)
	systemMsg := ComposeSystemPrompt(StepMergeBody, PromptContext{DocLang: mc.DocLang})
	userMsg := fmt.Sprintf(
		"合并以下 wiki 页面正文，保留旧内容所有重要信息，整合新内容增量。\n"+
			"仅输出完整 markdown 正文（不含 frontmatter）。\n"+
			"旧内容长度: %d 字符。合并结果不得少于旧内容的 70%%。\n\n"+
			"## 旧正文\n\n%s\n\n## 新正文\n\n%s",
		oldLen, oldBody, newBody,
	)
	messages := []llm.Message{
		{Role: "system", Content: systemMsg},
		{Role: "user", Content: userMsg},
	}

	const temp = 0.1
	const maxTok = 8192
	RecordLLMRequest(mc.Recorder, "merge_body", mc.LLMClient.Model(), llmMessagesForRecord(messages), temp, maxTok)

	ch, err := mc.LLMClient.StreamChat(ctx, messages, temp, maxTok)
	if err != nil {
		return "", err
	}

	var merged strings.Builder
	for event := range ch {
		switch event.Type {
		case "token":
			merged.WriteString(event.Content)
		case "error":
			return "", event.Error
		}
	}
	result := strings.TrimSpace(merged.String())
	RecordLLMResponse(mc.Recorder, "merge_body", result, 0)

	if oldLen > 0 {
		mergedLen := utf8.RuneCountInString(result)
		minLen := int(float64(oldLen) * mergeMinBodyRatio)
		if mergedLen < minLen {
			return "", fmt.Errorf("merge body too aggressive: merged %d chars < 70%% of old %d chars", mergedLen, oldLen)
		}
	}
	return result, nil
}

// MergeWikiPage merges newContent with an existing file at fullPath.
// Returns merged content, skipWrite=true when write should be skipped, or an error.
func MergeWikiPage(ctx context.Context, fullPath, newContent string, mc *MergeContext) (string, bool, error) {
	oldBytes, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return newContent, false, nil
		}
		return "", false, err
	}

	oldContent := string(oldBytes)
	if oldContent == newContent {
		return "", true, nil
	}

	oldFM, oldBody, oldHasFM := splitWikiPage(oldContent)
	newFM, newBody, newHasFM := splitWikiPage(newContent)

	if !oldHasFM && !newHasFM {
		if oldBody == newBody {
			return "", true, nil
		}
		mergedBody, err := mergeBodyLLM(ctx, mc, oldBody, newBody)
		if err != nil {
			return "", false, err
		}
		return mergedBody, false, nil
	}

	mergedFM, err := mergeFrontmatter(oldFM, newFM)
	if err != nil {
		return "", false, fmt.Errorf("merge frontmatter: %w", err)
	}

	mergedBody := oldBody
	if oldBody != newBody {
		mergedBody, err = mergeBodyLLM(ctx, mc, oldBody, newBody)
		if err != nil {
			return "", false, err
		}
	}

	return joinWikiPage(mergedFM, mergedBody), false, nil
}
