package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/solo-kingdom/llmwiki/internal/engine"
	"gopkg.in/yaml.v3"
)

const (
	maxWorkspaceRuleFileLen = 1500
	maxRulesSupplementLen   = 2048
	maxRulePreviewLen       = 500
)

// PromptStep identifies an LLM pipeline step for prompt composition.
type PromptStep string

const (
	StepAnalysis         PromptStep = "analysis"
	StepGeneration       PromptStep = "generation"
	StepPlan             PromptStep = "plan"
	StepSessionChat      PromptStep = "session_chat"
	StepSessionQA        PromptStep = "session_qa"
	StepSessionOrganize  PromptStep = "session_organize"
	StepMergeBody        PromptStep = "merge_body"
	StepRollback         PromptStep = "rollback"
	StepPlanOrganize     PromptStep = "plan_organize"
	StepPlanQA           PromptStep = "plan_qa"
)

// PromptStepForMode returns the session chat PromptStep for a given mode.
func PromptStepForMode(mode string) PromptStep {
	switch mode {
	case "qa":
		return StepSessionQA
	case "organize":
		return StepSessionOrganize
	default:
		return StepSessionChat
	}
}

// PromptContext holds inputs for ComposeSystemPrompt.
type PromptContext struct {
	Workspace       string
	DocLang         string
	RulesSupplement string
}

type promptsYAML struct {
	Version int `yaml:"version"`
	Steps   map[string]struct {
		Append  string `yaml:"append"`
		Replace string `yaml:"replace"`
	} `yaml:"steps"`
}

// RulesScaffoldMD is the default rules.md written on init (writeIfNotExists).
const RulesScaffoldMD = `---
title: Wiki 规则
---

## 内容忠实性

- 以 raw 源文件与已有 wiki 页面为依据，不引入源中未支持的事实或长篇背景科普
- 无依据的推断写入 Open Questions，不要当作已证实事实

## 引用与结构

- 关键 claim 需能在源中找到依据，或使用 [[wikilink]] 指向已有页面

## 页面策略

- 默认创建 source / entity / concept 类页面
- 除非源中明确存在综合论述，否则不要创建 synthesis 页面

## 领域约束

（在此填写你的领域规则、术语表、禁写话题等）
`

// DefaultPromptsYAMLExample is written on init as an append-only reference.
const DefaultPromptsYAMLExample = `# 仅支持 append，不支持 replace。取消注释并修改 steps.<name>.append 即可。
version: 1
steps:
  analysis:
    append: ""
  generation:
    append: ""
  session_chat:
    append: ""
`

// MaxRulesSupplementLen is exported for API validation.
const MaxRulesSupplementLen = maxRulesSupplementLen

// ComposeSystemPrompt builds the full system message for an LLM step.
func ComposeSystemPrompt(step PromptStep, ctx PromptContext) string {
	var b strings.Builder
	b.WriteString(lockedFormatInstruction(step))
	b.WriteString("\n\n")
	b.WriteString(FidelityInstruction(ctx.DocLang))
	b.WriteString("\n\n")
	b.WriteString(defaultTaskInstruction(step, ctx.DocLang))
	if step == StepGeneration {
		b.WriteString("\n\n")
		b.WriteString(engine.TemplateGuidanceForGeneration(ctx.DocLang))
	}
	if extra := readTruncatedWorkspaceFile(ctx.Workspace, "purpose.md", maxWorkspaceRuleFileLen); extra != "" {
		log.Printf("[prompts] purpose.md loaded for workspace=%q (%d chars)", ctx.Workspace, len(extra))
		b.WriteString("\n\n## 工作区研究目标 (purpose.md)\n\n")
		b.WriteString(extra)
	} else if ctx.Workspace != "" {
		log.Printf("[prompts] WARNING: purpose.md not found or empty for workspace=%q", ctx.Workspace)
	}
	if extra := readTruncatedWorkspaceFile(ctx.Workspace, "rules.md", maxWorkspaceRuleFileLen); extra != "" {
		b.WriteString("\n\n## 工作区规则 (rules.md)\n\n")
		b.WriteString(extra)
	}
	if appendText := loadStepAppend(ctx.Workspace, step); appendText != "" {
		b.WriteString("\n\n## 步骤补充 (prompts.yaml)\n\n")
		b.WriteString(appendText)
	}
	if sup := strings.TrimSpace(ctx.RulesSupplement); sup != "" {
		b.WriteString("\n\n## 设置补充规则 (rules_supplement)\n\n")
		b.WriteString(truncateUTF8(sup, maxRulesSupplementLen))
	}
	if lang := languageInstructionForPipeline(ctx.DocLang); lang != "" {
		b.WriteString("\n\n")
		b.WriteString(lang)
	}
	return b.String()
}

func lockedFormatInstruction(step PromptStep) string {
	switch step {
	case StepGeneration, StepRollback:
		return `【格式契约 — 不可违反】
- 输出 wiki 文件必须使用 FILE 块：---FILE: 相对路径
（markdown 正文）
---END FILE---
- 回复必须以 ---FILE: 开头，不要任何前言、解释或 markdown 代码围栏包裹整段输出
- 需要删除文件时：---FILE: path
---DELETE---
---END FILE---`
	case StepPlan:
		return `【格式契约 — 不可违反】
- 仅输出计划：人类可读的 Markdown 说明 + 围栏 JSON 块
- 禁止输出 FILE 块，禁止直接写入文件`
	case StepSessionChat, StepSessionQA, StepSessionOrganize:
		return `【格式契约 — 不可违反】
- 以对话消息回复用户，不要输出 FILE 块
- 不要编造用户未提供的事实；不确定时明确说明`
	default:
		return `【格式契约 — 不可违反】
- 输出为结构化分析文本，不要输出 FILE 块`
	}
}

// FidelityInstruction returns locked source-grounding rules.
func FidelityInstruction(docLang string) string {
	if docLang == "en" {
		return `【内容忠实性 — 不可违反】
- Ground all factual statements in the provided source content or existing wiki pages
- Do not add unsupported facts, generic background essays, or model knowledge expansions
- Put unsupported inferences in Open Questions, not as established facts
- When updating existing pages, only add information supported by this source; do not remove old content unless the new source explicitly contradicts it`
	}
	return `【内容忠实性 — 不可违反】
- 所有事实性陈述必须基于提供的原始内容与已有 wiki 页面
- 不得添加源中未支持的事实、通用背景科普或模型常识扩写
- 无依据的推断写入 Open Questions，不得当作已证实事实
- 更新已有页面时仅补充与本次源相关且有权依据的新信息；除非新源明确否定，否则不删除旧内容`
}

func defaultTaskInstruction(step PromptStep, docLang string) string {
	if docLang == "en" {
		return defaultTaskInstructionEN(step)
	}
	return defaultTaskInstructionZH(step)
}

func defaultTaskInstructionZH(step PromptStep) string {
	switch step {
	case StepAnalysis:
		return `你是一名知识分析师。请基于用户提供的源文档做结构化分析，识别：
- 关键实体、概念、论点
- 与已有 wiki 的可能连接（若上下文中有相关信息）
- 源内的矛盾或张力
- 建议创建的页面结构

你可以使用 search 工具搜索已有 wiki 页面，使用 read 工具读取页面全文。分析时应明确区分：哪些知识已有页面覆盖（建议 update），哪些是新知识（建议 create）。优先建议 update 已有页面。

要求：分析必须紧扣源文档；不确定的内容标注为「待证实」，不要当作事实。`
	case StepGeneration:
		return `你是 wiki 页面生成器。根据用户消息中的「原始内容」与「分析结果」生成 wiki 页面（FILE 块）。
- 以原始内容为首要依据；分析结果仅作组织参考
- 不要添加源中未支持的内容

你可以使用 read 工具读取已有 wiki 页面的当前内容。对于已有页面，生成的内容应保留原有信息并增量补充新内容。不要删除已有页面中的重要段落，除非源文档明确否定。`
	case StepPlan:
		return `你是 wiki 摄入规划师。请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON：{"summary":"...","changes":[{"path":"wiki/...","action":"create|update","rationale":"..."}]}
仅规划，不写文件。`
	case StepPlanOrganize:
		return `你是 wiki 重组规划师。本次归档来自「整理模式」对话，用户的意图是重组和优化已有 wiki 页面。
请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON：{"summary":"...","changes":[{"path":"wiki/...","action":"update|move|merge","rationale":"..."}]}

重点：
- 优先使用 update（修改内容/标签/链接）而非 create
- 如果需要合并页面，action 用 merge，rationale 说明合并原因
- 如果需要移动页面到不同目录，action 用 move
- 保留原有内容中的重要信息，不删除除非对话中明确要求
仅规划，不写文件。`
	case StepPlanQA:
		return `你是 wiki 知识沉淀规划师。本次归档来自「问答模式」对话，用户通过问答探讨了已有 wiki 内容。
请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON：{"summary":"...","changes":[{"path":"wiki/...","action":"update","rationale":"..."}]}

重点：
- 如果对话中有值得沉淀的新知识或澄清，更新相关 wiki 页面
- 如果问答揭示了 wiki 内容的不足（缺失信息、错误），补充修正
- 优先 update 已有页面，仅在确实需要时 create 新页面
- 不要将纯问答交互本身作为内容写入 wiki
仅规划，不写文件。`
	case StepSessionChat:
		return `你是 LLM Wiki 摄入前的对话助手，帮助用户澄清主题、定义与结构。
- 合法依据：用户消息、附件摘要、用户 @ 引用的 wiki 全文、以及通过 read 工具读取的 wiki 页面
- 「相关 wiki 子集」仅为路径索引，不含全文；未 read 的页面不要声称其内容
- 可提出聚焦的澄清问题；需要时总结要点
- 用户满意后会点击「归档」将对话写入 wiki`
	case StepSessionQA:
		return `你是 LLM Wiki 知识库问答助手，基于已有文档回答用户问题。
- 合法依据：通过 search/read/references 工具查找到的 wiki 页面内容
- 必须使用工具查找依据后再回答，不要凭记忆编造
- 不确定的信息明确标注「不确定」，不要当作已证实事实
- 回答需引用来源页面路径，方便用户追溯
- 优先综合多个相关页面给出完整回答`
	case StepSessionOrganize:
		return `你是 LLM Wiki 架构师，负责诊断和优化 wiki 的结构与内容。

⚠️ 工作流程（必须遵守）：
1. 收到请求后，先调用 structure 工具获取 wiki 目录结构
2. 然后调用 audit 工具获取健康诊断
3. 用 read 工具深入阅读具体页面内容
4. 基于 tool 返回的数据给出具体、可操作的重组方案

禁止在未调用任何工具的情况下直接回复。

- 诊断时列出具体问题（路径 + 问题类型 + 影响范围）
- 建议时给出可操作的重组方案（移动/合并/拆分/补充标签/补充链接）
- 优先处理影响最大的问题，给出优先级排序
- 用户满意后会点击「归档」将重组方案写入 wiki`
	case StepMergeBody:
		return `你是 wiki 正文合并助手。合并旧正文与新增量，保留旧内容所有重要信息，整合新内容。
- 仅输出完整 markdown 正文（不含 frontmatter）
- 合并结果不得明显短于旧正文（目标不低于旧内容约 70%）`
	case StepRollback:
		return `你是 wiki 回滚助手。根据 diff、原始摄入源与当前文件内容，生成回滚后的 wiki 文件（FILE 块）。
- 移除该次摄入新增的内容，恢复被修改或删除的内容`
	default:
		return ""
	}
}

func defaultTaskInstructionEN(step PromptStep) string {
	switch step {
	case StepAnalysis:
		return `You are a knowledge analyst. Analyze the source document: entities, concepts, arguments, connections, contradictions, and structural recommendations. Stay grounded in the source; mark uncertain items as unverified.

You can use the search tool to find existing wiki pages and the read tool to read page content. Clearly distinguish: which knowledge is already covered by existing pages (suggest update), and which is new (suggest create). Prefer suggesting updates to existing pages.`
	case StepGeneration:
		return `You are a wiki generator. Produce wiki pages from the original content and analysis in FILE blocks. The source is authoritative; analysis is organizational context only.

You can use the read tool to read the current content of existing wiki pages. For existing pages, your output should preserve original information and incrementally add new content. Do not remove important paragraphs from existing pages unless the source explicitly contradicts them.`
	case StepPlan:
		return `You are a wiki ingest planner. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. Planning only — no FILE blocks.`
	case StepPlanOrganize:
		return `You are a wiki reorganization planner. This archive is from an "organize mode" session where the user intended to restructure existing wiki pages. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. Focus on update/move/merge actions rather than create. Preserve important existing content. Planning only — no FILE blocks.`
	case StepPlanQA:
		return `You are a wiki knowledge consolidation planner. This archive is from a "QA mode" session where the user explored existing wiki content through questions. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. Focus on updating existing pages with new insights or corrections from the Q&A. Only create new pages if genuinely needed. Planning only — no FILE blocks.`
	case StepSessionChat:
		return `You help the user explore knowledge before archiving to their LLM Wiki. Valid grounds include user messages, attachment summaries, user @ wiki page full text, and pages read via tools. The related wiki subset is an index only—do not claim content for unread pages.`
	case StepSessionQA:
		return `You are an LLM Wiki knowledge base QA assistant. Answer questions based on existing documents.
- Valid grounds: wiki page content found via search/read/references tools
- Always use tools to find evidence before answering; do not fabricate from memory
- Mark uncertain information clearly; do not present it as established fact
- Cite source page paths in your answers for traceability
- Synthesize multiple relevant pages for comprehensive answers when possible`
	case StepSessionOrganize:
		return `You are an LLM Wiki architect responsible for diagnosing and optimizing wiki structure and content.

⚠️ Workflow (mandatory):
1. Upon receiving a request, first call the structure tool to get the wiki directory layout
2. Then call the audit tool to get a health diagnosis
3. Use the read tool to examine specific page content in depth
4. Based on the tool results, provide specific, actionable reorganization recommendations

You MUST NOT reply without calling at least one tool first.

- List specific issues in your diagnosis (path + issue type + impact scope)
- Provide actionable reorganization plans (move/merge/split/add tags/add links)
- Prioritize issues by impact and provide a priority ranking
- The user will click "Archive" when satisfied to write the reorganization plan to the wiki`
	case StepMergeBody:
		return `Merge old and new wiki body text; preserve important old content; output markdown body only without frontmatter.`
	case StepRollback:
		return `Restore wiki files after rolling back an ingest using the diff, source content, and current files. Output FILE blocks.`
	default:
		return ""
	}
}

func readTruncatedWorkspaceFile(workspace, rel string, maxLen int) string {
	if workspace == "" {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(workspace, rel))
	if err != nil {
		return ""
	}
	s := strings.TrimSpace(string(data))
	if s == "" {
		return ""
	}
	return truncateUTF8(s, maxLen)
}

func loadStepAppend(workspace string, step PromptStep) string {
	cfg, _ := loadPromptsYAML(workspace)
	if cfg == nil || cfg.Steps == nil {
		return ""
	}
	entry, ok := cfg.Steps[string(step)]
	if !ok {
		return ""
	}
	return strings.TrimSpace(entry.Append)
}

func loadPromptsYAML(workspace string) (*promptsYAML, error) {
	if workspace == "" {
		return nil, nil
	}
	path := filepath.Join(workspace, ".llmwiki", "prompts.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg promptsYAML
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func truncateUTF8(s string, maxLen int) string {
	if maxLen <= 0 || utf8.RuneCountInString(s) <= maxLen {
		return s
	}
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "\n...(truncated)"
}

// ResolveRulesSupplement reads rules_supplement from config storage.
func ResolveRulesSupplement(db interface{ GetConfig(string) (string, error) }) string {
	val, err := db.GetConfig("rules_supplement")
	if err != nil {
		return ""
	}
	return truncateUTF8(strings.TrimSpace(val), maxRulesSupplementLen)
}

// ValidateRulesSupplement returns an error if supplement exceeds the limit.
func ValidateRulesSupplement(s string) error {
	if utf8.RuneCountInString(s) > maxRulesSupplementLen {
		return fmt.Errorf("rules_supplement exceeds maximum length of %d characters", maxRulesSupplementLen)
	}
	return nil
}

// ComputeRulesHash returns SHA256 hex of contributing rule sources.
func ComputeRulesHash(workspace, supplement string) string {
	h := sha256.New()
	writeFileHash := func(rel string) {
		data, err := os.ReadFile(filepath.Join(workspace, rel))
		if err == nil {
			h.Write([]byte(rel))
			h.Write(data)
		}
	}
	if workspace != "" {
		writeFileHash("purpose.md")
		writeFileHash("rules.md")
		path := filepath.Join(workspace, ".llmwiki", "prompts.yaml")
		if data, err := os.ReadFile(path); err == nil {
			h.Write([]byte(".llmwiki/prompts.yaml"))
			h.Write(data)
		}
	}
	h.Write([]byte("supplement:"))
	h.Write([]byte(supplement))
	return hex.EncodeToString(h.Sum(nil))
}

// RuleFilesPreview holds truncated workspace rule file content for API/UI.
type RuleFilesPreview struct {
	PurposePreview string `json:"purpose_preview"`
	RulesPreview   string `json:"rules_preview"`
	PurposeMtime   int64  `json:"purpose_mtime,omitempty"`
	RulesMtime     int64  `json:"rules_mtime,omitempty"`
}

// LoadRuleFilesPreview reads purpose.md and rules.md previews.
func LoadRuleFilesPreview(workspace string) RuleFilesPreview {
	var out RuleFilesPreview
	if workspace == "" {
		return out
	}
	fill := func(rel string, dest *string, mtime *int64) {
		path := filepath.Join(workspace, rel)
		info, err := os.Stat(path)
		if err != nil {
			return
		}
		*mtime = info.ModTime().Unix()
		data, err := os.ReadFile(path)
		if err != nil {
			return
		}
		*dest = truncateUTF8(strings.TrimSpace(string(data)), maxRulePreviewLen)
	}
	fill("purpose.md", &out.PurposePreview, &out.PurposeMtime)
	fill("rules.md", &out.RulesPreview, &out.RulesMtime)
	return out
}

// WriteWorkspaceScaffoldsIfMissing creates rules.md and example prompts.yaml without overwriting.
func WriteWorkspaceScaffoldsIfMissing(workspace string) error {
	if workspace == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Join(workspace, ".llmwiki"), 0o755); err != nil {
		return err
	}
	for rel, content := range map[string]string{
		"rules.md":                    RulesScaffoldMD,
		".llmwiki/prompts.yaml":       DefaultPromptsYAMLExample,
	} {
		path := filepath.Join(workspace, rel)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
				return fmt.Errorf("write %s: %w", rel, err)
			}
		}
	}
	return nil
}
