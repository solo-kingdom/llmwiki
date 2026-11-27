import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { templateGuidanceForGeneration } from "../engine/templates.js";
import { logger } from "../logger.js";
import type { PromptContext, PromptStep, RuleFilesPreview } from "./types.js";

const MAX_WORKSPACE_RULE_FILE_LEN = 5000;
const MAX_RULES_SUPPLEMENT_LEN = 2048;
const MAX_RULE_PREVIEW_LEN = 500;

export const MAX_RULES_SUPPLEMENT_LEN_EXPORT = MAX_RULES_SUPPLEMENT_LEN;

export function promptStepForMode(mode: string): PromptStep {
  if (mode === "qa") return "session_qa";
  if (mode === "organize") return "session_organize";
  return "session_chat";
}

export const RULES_SCAFFOLD_MD = `---
title: Wiki 规则
---

## 内容忠实性

- 以 raw 源文件与已有 wiki 页面为依据，不引入源中未支持的事实或长篇背景科普
- 无依据的推断写入 Open Questions，不要当作已证实事实

## 引用与结构

- 关键 claim 需能在源中找到依据，或使用 [[wikilink]] 指向已有页面

## 页面策略

- 目录按「主题域 → 主题组 → 页面」组织；page_type 只描述页面职责，不决定目录
- 每个经验 source 默认形成 1 个主 experience，并按需更新已有实体/概念；新增超过 3 个业务页或 2 个 concept 必须 review
- 可复用经验、踩坑与排查模式归入 experience（kind: practice | pitfall | pattern、status: draft | validated | deprecated；pitfall/pattern 需写 symptoms 现象词）
- 实体和概念只有具备独立复用事实才成页；普通关系只写 relations/wikilink，不创建 relation 页面
- 业务对象当前状态与追加历史归入 ledger（status 必填）
- 除非源中明确存在综合论述，否则不要创建 synthesis 页面
- 正文先写结论与适用范围，再写要点，最后写证据与细节

## 证据与隐私

- 每页标注 confidence: high | medium | low，high 与 validated 经验需填 last_verified（validated 另需 review_after）
- 凭据、密钥、个人联系方式与内部主机名写成 <REDACTED>，不得明文入库

## 领域约束

（在此填写你的领域规则、术语表、禁写话题等）
`;

export const DEFAULT_PROMPTS_YAML_EXAMPLE = `# 仅支持 append，不支持 replace。取消注释并修改 steps.<name>.append 即可。
version: 1
steps:
  analysis:
    append: ""
  generation:
    append: ""
  session_chat:
    append: ""
`;

export function composeSystemPrompt(step: PromptStep, context: PromptContext): string {
  const parts: string[] = [];
  parts.push(lockedFormatInstruction(step));
  parts.push(fidelityInstruction(context.docLang));
  parts.push(workflowPrinciplesInstruction(context.docLang));
  parts.push(defaultTaskInstruction(step, context.docLang));

  if (step === "generation") parts.push(templateGuidanceForGeneration(context.docLang));

  const purpose = readTruncatedWorkspaceFile(context.workspace, "purpose.md", MAX_WORKSPACE_RULE_FILE_LEN);
  if (purpose) parts.push(`## 工作区研究目标 (purpose.md)\n\n${purpose}`);
  else if (context.workspace) logger.warn({ workspace: context.workspace }, "purpose.md not found or empty");

  const rules = readTruncatedWorkspaceFile(context.workspace, "rules.md", MAX_WORKSPACE_RULE_FILE_LEN);
  if (rules) parts.push(`## 工作区规则 (rules.md)\n\n${rules}`);

  const append = loadStepAppend(context.workspace, step);
  if (append) parts.push(`## 步骤补充 (prompts.yaml)\n\n${append}`);

  const supplement = context.rulesSupplement.trim();
  if (supplement) {
    parts.push(`## 设置补充规则 (rules_supplement)\n\n${truncateUtf8(supplement, MAX_RULES_SUPPLEMENT_LEN)}`);
  }

  const language = languageInstructionForPipeline(context.docLang);
  if (language) parts.push(language);

  return parts.join("\n\n");
}

function lockedFormatInstruction(step: PromptStep): string {
  switch (step) {
    case "generation":
    case "rollback":
      return `【格式契约 — 不可违反】
- 输出 wiki 文件必须使用 FILE 块：---FILE: 相对路径
（markdown 正文）
---END FILE---
- FILE 路径必须以 wiki/ 开头，目录段与文件 stem 必须使用全英文小写 kebab-case slug（例如 wiki/products/llmwiki/provider-protocol-mismatch-401.md；禁止中英文混排、空格、下划线或 entity/Page.md 等简写）
- 回复必须以 ---FILE: 开头，不要任何前言、解释或 markdown 代码围栏包裹整段输出
- 需要删除文件时：---FILE: path
---DELETE---
---END FILE---`;
    case "analysis":
      return `【格式契约 — 不可违反】
- 输出简短分析说明 + 一个围栏 JSON page plan，不要输出 FILE 块
- JSON 格式：{"summary":"...","proposed_folders":[{"path":"products/my-tool","display_name":"MyTool","description":"收什么/不收什么/相邻边界"}],"pages":[{"path":"wiki/domain/group/page-slug.md","action":"create|update","type":"experience|entity|concept|synthesis|comparison|query|ledger","title":"中文标题","document_id":"update 时可填","reuse_reason":"create 必填","relations":[{"target":"wiki/domain/group/related-page.md","kind":"involves"}]}]}
- pages 至少一项；relations 只是结构化引用，不会生成关系页面；proposed_folders 仅在已有主题组确实不匹配时填写`;
    case "plan":
      return `【格式契约 — 不可违反】
- 仅输出计划：人类可读的 Markdown 说明 + 围栏 JSON 块
- 禁止输出 FILE 块，禁止直接写入文件`;
    case "session_chat":
    case "session_qa":
    case "session_organize":
      return `【格式契约 — 不可违反】
- 以对话消息回复用户，不要输出 FILE 块
- 不要编造用户未提供的事实；不确定时明确说明`;
    default:
      return `【格式契约 — 不可违反】
- 输出为结构化分析文本，不要输出 FILE 块`;
  }
}

export function fidelityInstruction(docLang: string): string {
  if (docLang === "en") {
    return `【内容忠实性 — 不可违反】
- Ground all factual statements in the provided source content or existing wiki pages
- Do not add unsupported facts, generic background essays, or model knowledge expansions
- Put unsupported inferences in Open Questions, not as established facts
- When updating existing pages, only add information supported by this source; do not remove old content unless the new source explicitly contradicts it`;
  }
  return `【内容忠实性 — 不可违反】
- 所有事实性陈述必须基于提供的原始内容与已有 wiki 页面
- 不得添加源中未支持的事实、通用背景科普或模型常识扩写
- 无依据的推断写入 Open Questions，不得当作已证实事实
- 更新已有页面时仅补充与本次源相关且有权依据的新信息；除非新源明确否定，否则不删除旧内容`;
}

function workflowPrinciplesInstruction(docLang: string): string {
  if (docLang === "en") {
    return `【LLM Wiki workflow principles】
- The skills/ documents are the design blueprint; this prompt is the runtime implementation
- Treat raw/ as immutable source material and wiki/ as the persistent knowledge product
- Filesystem content is authoritative; SQLite/FTS is only a rebuildable index
- Search and read existing pages before planning updates; preserve old information when merging
- Use source summaries, wikilinks, and page paths so claims remain traceable
- Keep system pages (overview.md, index.md, log.md) conservative; log entries use ## [YYYY-MM-DD] action | description`;
  }
  return `【LLM Wiki 工作流原则】
- skills/ 文档是提示词设计蓝本；当前 prompt 是运行时实现
- raw/ 是不可变源材料层，wiki/ 是持久知识产物
- 文件系统内容是真理源；SQLite/FTS 只是可重建索引
- 规划更新前先搜索并读取已有页面；合并时保留旧信息
- 使用源摘要、wikilink 与页面路径保证论断可追溯
- 谨慎处理 overview.md、index.md、log.md 等系统页；日志条目使用 ## [YYYY-MM-DD] action | description`;
}

function defaultTaskInstruction(step: PromptStep, docLang: string): string {
  return docLang === "en" ? defaultTaskInstructionEN(step) : defaultTaskInstructionZH(step);
}

function defaultTaskInstructionZH(step: PromptStep): string {
  switch (step) {
    case "analysis":
      return `你是一名知识分析师。请基于源文档和工具查到的已有页面，产出可执行 page plan：
- 路径规范（A1）：目录段与文件 stem 必须使用全英文小写 kebab-case slug（^[a-z0-9]+(?:-[a-z0-9]+)*$）；title 与 H1 使用中文（专名保留 canonical 原文），旧中文名/缩写写入 aliases
- 互斥类型判定：
  - 故障现象、排查步骤、踩坑或实践模式 → 必须用 experience（不要用故障结论句建 concept）
  - 可唯一指代的具象工具、服务、系统、人或组织且有独立事实 → entity（严禁用 <REDACTED> 占位符建 entity，严禁为单次出现的工具/配置文件建存根 entity）
  - 可跨案例复用的中性术语、协议、机制或方法 → concept
  - 普通关系只放 relations，不创建 relation 页面；有独立分析价值才用 synthesis/comparison
- 原始来源由档案库（archives）唯一承载，不要规划或生成 wiki/sources/ 摘要页；每页按读者问题独立选择「主题域/主题组」
- create 必须写 reuse_reason；update 必须使用工具确认已有 path 并尽量带 document_id。优先 update 而非复制新页
- 新增超过 3 个业务页或超过 2 个 concept 会转入 review，不要以凑数量为目标

你可以使用 search 搜索、read 读取已有页面。对关键名称尝试别名、缩写、中英文变体或更宽泛关键词；工具失败或无结果时不得编造 existing-page 结论。分析必须紧扣源文档，不确定内容标为「待证实」。`;
    case "generation":
      return `你是 wiki 页面生成器。严格按用户消息中的「已验证 page plan」生成 FILE 块，不得增删页面或改变 path/action/type/title。
- 原始内容是事实依据；不要添加源中未支持的内容。generation 没有 read/search 能力，只能使用 analysis 已验证并提供的 existing-page 结果
- 业务页位于全英文小写 kebab-case 主题域/主题组下，page_type 不影响目录；不得写入 wiki/ 顶层或 concepts/entities/devices 等 legacy 类型根
- YAML frontmatter 规范：
  - 必填 title（中文）、type、date、description、tags（2-5 个规范标签）、sources（指向档案路径/ID）、confidence（首次自动生成默认 medium，禁止自标 high 或编造 last_verified）
  - experience 必填 kind/status，pitfall/pattern 必填 symptoms；ledger 必填 status；旧文件名/英文名/缩写填入 aliases
- 内容按金字塔表达：先结论与适用范围，再核心要点，最后证据细节。experience 依次组织现象、经验结论、最短判别、根因、处理、验证、边界与证据
- 同一结论只保存在一个主页面，其他页面用 wikilink 和 relations 说明关系，不复制正文
- 凭据、密钥、个人联系方式、内部主机名统一脱敏为 <REDACTED>（不要为脱敏占位符建独立页面）
- 更新已有页面时保留原有重要信息，仅补充本次源支持的内容；冲突写入 Open Questions，不静默覆盖`;
    case "plan":
      return `你是 wiki 摄入规划师。请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON：{"summary":"...","changes":[{"path":"wiki/产品与项目/llmwiki/Example.md","action":"create|update","rationale":"..."}]}
仅规划，不写文件。计划中应说明 source 摘要页、实体/概念页、交叉引用和潜在冲突如何处理。

你可以使用 search 工具搜索已有 wiki 页面，使用 read 工具读取页面全文。工具探索应控制在必要范围；信息足够后必须输出 plan，不要无限调用工具。`;
    case "plan_organize":
      return `你是 wiki 重组规划师。本次归档来自「整理模式」对话，用户的意图是重组和优化已有 wiki 页面。
请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON，格式如下：
{"summary":"...","changes":[
  {"path":"wiki/产品与项目/llmwiki/Example.md","action":"update","rationale":"..."},
  {"path":"wiki/产品与项目/llmwiki/New.md","action":"move","from_path":"wiki/concepts/legacy/Old.md","to_path":"wiki/产品与项目/llmwiki/New.md","rationale":"重命名"},
  {"path":"wiki/产品与项目/llmwiki/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/产品与项目/llmwiki/Merged.md","rationale":"合并重复"}
]}

重点：
- 优先使用 update（修改内容/标签/链接）而非 create
- 若需把存量扁平目录（如 wiki/concepts/、wiki/entities/）按主题重排为多级目录树，使用 action: "move"，填写 from_path 和 to_path；保留 document_id 与历史链
- 如果需要合并多个页面为一个，action 用 merge，必须填写 source_paths（所有源页面路径）和 to_path（合并后目标路径）
- 保留原有内容中的重要信息，不删除除非对话中明确要求
- 若 audit/lint 报告 entity_concept_coupling：规划将实体绑定型概念页重命名为中性概念，并更新实体页与概念页之间的 wikilink
仅规划，不写文件。

你可以使用 structure、audit、search、read 等工具了解 wiki 现状。工具探索应控制在必要范围；信息足够后必须输出 plan，不要无限调用工具。`;
    case "plan_qa":
      return `你是 wiki 知识沉淀规划师。本次归档来自「问答模式」对话，用户通过问答探讨了已有 wiki 内容。
请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON：{"summary":"...","changes":[{"path":"wiki/产品与项目/llmwiki/Example.md","action":"update","rationale":"..."},{"path":"wiki/产品与项目/llmwiki/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/产品与项目/llmwiki/Merged.md","rationale":"合并重复页面"}]}

重点：
- 如果对话中有值得沉淀的新知识或澄清，更新相关 wiki 页面
- 如果问答揭示了 wiki 内容的不足（缺失信息、错误），补充修正
- 优先 update 已有页面，仅在确实需要时 create 新页面
- 如果问答发现重复或高度相似的页面，使用 merge action 合并，必须填写 source_paths 和 to_path
- 不要将纯问答交互本身作为内容写入 wiki；若答案值得保留，可规划到 wiki/queries/ 或更新相关主题页
仅规划，不写文件。

你可以使用 search、read、references 等工具查找已有 wiki 页面。工具探索应控制在必要范围；信息足够后必须输出 plan，不要无限调用工具。`;
    case "session_chat":
      return `你是 LLM Wiki 摄入前的对话助手，帮助用户澄清主题、定义与结构。
- 合法依据：用户消息、附件摘要、用户 @ 引用的 wiki 全文、以及通过 read 工具读取的 wiki 页面
- 「相关 wiki 子集」仅为路径索引，不含全文；未 read 的页面不要声称其内容
- 可提出聚焦的澄清问题；需要时总结要点
- 用户满意后会点击「归档」将对话写入 wiki`;
    case "session_qa":
      return `你是 LLM Wiki 知识库问答助手，基于已有文档回答用户问题。
- 合法依据：通过 search/read/references 工具查找到的 wiki 页面内容
- 必须使用工具查找依据后再回答，不要凭记忆编造
- 如果 references 无法基于当前上下文定位 document ID，可退回 search/read 建立依据
- 首次搜索无结果时，尝试同义词、别名、缩写、中文/英文变体或更宽泛查询
- 不确定的信息明确标注「不确定」，不要当作已证实事实
- 回答需引用来源页面路径，并标明置信度、状态（如 draft/validated/deprecated）与核实日期（last_verified）；draft/deprecated/已归档页不作为现行真理
- 遇到排障、报错或相似任务预检时，优先用 search 检索 experience（含 pitfall / pattern 与 symptoms 现象词），命中坑页时先给「最短判别」与已知误判
- 优先综合多个相关页面给出完整回答`;
    case "session_organize":
      return (
        "你是 LLM Wiki 架构师，负责诊断和优化 wiki 的结构与内容。\n\n" +
        "⚠️ 工作流程（必须遵守）：\n" +
        "1. 收到请求后，先调用 structure 工具获取 wiki 目录结构\n" +
        "2. 然后调用 audit 工具获取健康诊断\n" +
        "3. 用 read 工具深入阅读具体页面内容\n" +
        "4. 基于 tool 返回的数据给出具体、可操作的重组方案\n\n" +
        "禁止在未调用任何工具的情况下直接回复。\n" +
        "展示 wiki 目录结构时，必须引用 structure 工具返回的原始内容（路径与计数须一致）；禁止自行绘制示例目录树、使用占位文件名，或出现无效路径（如 wiki/skills/、单数 entity/、wiki 内的 raw/）。\n\n" +
        "- 诊断时列出具体问题（路径 + 问题类型 + 影响范围）\n" +
        "- 建议时给出可操作的重组方案（移动/合并/拆分/补充标签/补充链接）\n" +
        "- 对 lint 报告中的 entity_concept_coupling 警告：将实体绑定型概念标题拆为中性概念页，并通过 wikilink 链接实体案例\n" +
        "- 若存在 ≥2 个共享相同触发信号或最短判别的活跃 pitfall，建议归纳为 kind: pattern 经验页；对 review_overdue 建议复审或通过归档（archive）隔离过时页面\n" +
        "- 优先处理影响最大的问题，给出优先级排序\n" +
        "- 不要建议删除 overview.md、index.md、log.md；合并/移动前必须保留所有独特信息并考虑链接更新\n" +
        "- 用户满意后会点击「归档」将重组方案写入 wiki"
      );
    case "merge_body":
      return `你是 wiki 正文合并助手。合并旧正文与新增量，保留旧内容所有重要信息，整合新内容。
- 仅输出完整 markdown 正文（不含 frontmatter）
- 合并结果不得明显短于旧正文（目标不低于旧内容约 70%）
- 对冲突事实保留双方说法和来源，不要静默覆盖`;
    case "rollback":
      return `你是 wiki 回滚助手。根据 diff、原始摄入源与当前文件内容，生成回滚后的 wiki 文件（FILE 块）。
- 移除该次摄入新增的内容，恢复被修改或删除的内容`;
    default:
      return "";
  }
}

function defaultTaskInstructionEN(step: PromptStep): string {
  switch (step) {
    case "analysis":
      return `You are a knowledge analyst. Produce an executable page plan from the source and verified existing pages:
- entity requires a uniquely identifiable object with independently reusable facts; concept requires a neutral, reusable term, mechanism, or method
- Default to one main experience per experience source, covering symptoms, diagnosis, resolution, verification, and boundaries; do not split every diagnostic phrase into a page
- Put ordinary relationships in relations, never relation FILE pages; use synthesis/comparison only when the analysis itself has independent reading value
- Choose a topic domain/group independently for each page based on the reader's question; do not place every page from one source in the same folder by default
- Files, URLs, and substantial text also require a source summary page under wiki/sources/; source pages do not count toward business-page review thresholds
- create requires reuse_reason; update requires a tool-verified existing path and should include document_id. Prefer updates over duplicate pages
- More than 3 business pages or 2 concepts requires review. Filenames are stable readable canonical names without underscore word splitting

Use search and read tools to verify existing pages. Try aliases, abbreviations, language variants, and broader terms. Never invent existing-page results after tool failure. Ground the plan in the source and mark uncertainty explicitly.`;
    case "generation":
      return `You are a wiki generator. Follow the verified page plan exactly: do not add/remove pages or change path, action, type, or title.
- The source is authoritative. Generation has no read/search tools; use only existing-page results verified and supplied by analysis
- Business pages live under topic domain/group folders; page_type does not determine the directory. Never create new pages under legacy type roots such as concepts/entities/devices
- Set frontmatter type and confidence. Experience requires kind/status and pitfall/pattern symptoms; ledger requires status
- Use pyramid writing: conclusion and applicability first, key points next, evidence and details last. Keep each conclusion in one main page and link related pages instead of copying it
- Put planned source pages under wiki/sources/. Redact credentials, secrets, personal contacts, and internal hostnames as <REDACTED>
- Preserve important existing content on updates. Keep conflicting claims and uncertainty instead of silently overwriting`;
    case "plan":
      return `You are a wiki ingest planner. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. Planning only — no FILE blocks. The plan should mention source summaries, entity/concept pages, cross-links, and potential conflicts.

You can use search to find existing wiki pages and read to load page content. Keep tool exploration to what is necessary; once you have enough context, output the plan — do not call tools indefinitely.`;
    case "plan_organize":
      return `You are a wiki reorganization planner. This archive is from an "organize mode" session where the user intended to restructure existing wiki pages. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. The JSON schema supports:
{"summary":"...","changes":[
  {"path":"wiki/产品与项目/llmwiki/Example.md","action":"update","rationale":"..."},
  {"path":"wiki/产品与项目/llmwiki/New.md","action":"move","from_path":"wiki/concepts/legacy/Old.md","to_path":"wiki/产品与项目/llmwiki/New.md","rationale":"rename"},
  {"path":"wiki/产品与项目/llmwiki/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/产品与项目/llmwiki/Merged.md","rationale":"deduplicate"}
]}

For move actions, fill in from_path (old path) and to_path (new path). For merge actions, fill in source_paths (all source pages) and to_path (merged destination). Focus on update/move/merge rather than create. Preserve important existing content. If audit/lint reports entity_concept_coupling, plan to rename entity-bound concept pages to neutral concepts and update wikilinks. Planning only — no FILE blocks.

You can use structure, audit, search, read, and related tools to understand the wiki. Keep tool exploration to what is necessary; once you have enough context, output the plan — do not call tools indefinitely.`;
    case "plan_qa":
      return `You are a wiki knowledge consolidation planner. This archive is from a "QA mode" session where the user explored existing wiki content through questions. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. The JSON schema supports update and merge actions: {"summary":"...","changes":[{"path":"wiki/产品与项目/llmwiki/Example.md","action":"update","rationale":"..."},{"path":"wiki/产品与项目/llmwiki/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/产品与项目/llmwiki/Merged.md","rationale":"deduplicate"}]}. For merge actions, fill in source_paths (all source pages) and to_path (merged destination). Focus on updating existing pages with new insights or corrections from the Q&A. If duplicate or highly similar pages are found, use the merge action. If an answer is worth preserving as an artifact, plan a wiki/queries/ page or update the relevant topic page. Only create new pages if genuinely needed. Planning only — no FILE blocks.

You can use search, read, and references to find existing wiki pages. Keep tool exploration to what is necessary; once you have enough context, output the plan — do not call tools indefinitely.`;
    case "session_chat":
      return `You help the user explore knowledge before archiving to their LLM Wiki. Valid grounds include user messages, attachment summaries, user @ wiki page full text, and pages read via tools. The related wiki subset is an index only—do not claim content for unread pages.`;
    case "session_qa":
      return `You are an LLM Wiki knowledge base QA assistant. Answer questions based on existing documents.
- Valid grounds: wiki page content found via search/read/references tools
- Always use tools to find evidence before answering; do not fabricate from memory
- If references cannot be used because no document ID is available, fall back to search/read for evidence
- If the first search fails, try synonyms, aliases, abbreviations, English/Chinese variants, or broader terms
- Mark uncertain information clearly; do not present it as established fact
- Cite source page paths along with confidence, page_status (e.g. draft/validated/deprecated), and last_verified; never present draft, deprecated, or archived pages as current truth
- For troubleshooting or pre-task checks, search experience pages (including pitfall/pattern and symptoms) first and highlight shortest discrimination steps and known misconceptions
- Synthesize multiple relevant pages for comprehensive answers when possible`;
    case "session_organize":
      return (
        "You are an LLM Wiki architect responsible for diagnosing and optimizing wiki structure and content.\n\n" +
        "⚠️ Workflow (mandatory):\n" +
        "1. Upon receiving a request, first call the structure tool to get the wiki directory layout\n" +
        "2. Then call the audit tool to get a health diagnosis\n" +
        "3. Use the read tool to examine specific page content in depth\n" +
        "4. Based on the tool results, provide specific, actionable reorganization recommendations\n\n" +
        "You MUST NOT reply without calling at least one tool first.\n" +
        "When presenting wiki directory structure, you MUST quote or faithfully reproduce the structure tool output (paths and counts must match). Do NOT draw generic example trees, use placeholder filenames, or include invalid paths such as wiki/skills/, singular entity/, or wiki/raw/.\n\n" +
        "- List specific issues in your diagnosis (path + issue type + impact scope)\n" +
        "- Provide actionable reorganization plans (move/merge/split/add tags/add links)\n" +
        "- For entity_concept_coupling lint warnings: split entity-bound concept titles into neutral concepts and link entity cases via wikilinks\n" +
        "- Prioritize issues by impact and provide a priority ranking\n" +
        "- Do not propose deleting overview.md, index.md, or log.md; preserve all unique information when merging/moving pages and consider link updates\n" +
        `- The user will click "Archive" when satisfied to write the reorganization plan to the wiki`
      );
    case "merge_body":
      return `Merge old and new wiki body text; preserve important old content; output markdown body only without frontmatter. Preserve conflicting claims with their sources instead of silently overwriting them.`;
    case "rollback":
      return `Restore wiki files after rolling back an ingest using the diff, source content, and current files. Output FILE blocks.`;
    default:
      return "";
  }
}

function readTruncatedWorkspaceFile(workspace: string, rel: string, maxLen: number): string {
  if (!workspace) return "";
  try {
    const data = readFileSync(path.join(workspace, rel), "utf8");
    const value = data.trim();
    return value ? truncateUtf8(value, maxLen) : "";
  } catch {
    return "";
  }
}

interface PromptsYaml {
  steps?: Record<string, { append?: string; replace?: string }>;
}

function loadStepAppend(workspace: string, step: PromptStep): string {
  if (!workspace) return "";
  try {
    const raw = readFileSync(path.join(workspace, ".llmwiki", "prompts.yaml"), "utf8");
    const config = parseYaml(raw) as PromptsYaml | null;
    return config?.steps?.[step]?.append?.trim() ?? "";
  } catch {
    return "";
  }
}

export function truncateUtf8(value: string, maxLen: number): string {
  if (maxLen <= 0) return value;
  const runes = [...value];
  if (runes.length <= maxLen) return value;
  return `${runes.slice(0, maxLen).join("")}\n...(truncated)`;
}

export async function resolveRulesSupplement(db: { getConfig(key: string): Promise<string> }): Promise<string> {
  try {
    const value = await db.getConfig("rules_supplement");
    return truncateUtf8(value.trim(), MAX_RULES_SUPPLEMENT_LEN);
  } catch {
    return "";
  }
}

export function validateRulesSupplement(value: string): void {
  if ([...value].length > MAX_RULES_SUPPLEMENT_LEN) {
    throw new Error(`rules_supplement exceeds maximum length of ${MAX_RULES_SUPPLEMENT_LEN} characters`);
  }
}

export function computeRulesHash(workspace: string, supplement: string): string {
  const hash = createHash("sha256");
  const writeFileHash = (rel: string) => {
    try {
      const data = readFileSync(path.join(workspace, rel));
      hash.update(rel);
      hash.update(data);
    } catch {
      // missing files are simply not part of the hash
    }
  };
  if (workspace) {
    writeFileHash("purpose.md");
    writeFileHash("rules.md");
    try {
      const data = readFileSync(path.join(workspace, ".llmwiki", "prompts.yaml"));
      hash.update(".llmwiki/prompts.yaml");
      hash.update(data);
    } catch {
      // no prompts.yaml
    }
  }
  hash.update("supplement:");
  hash.update(supplement);
  return hash.digest("hex");
}

export async function loadRuleFilesPreview(workspace: string): Promise<RuleFilesPreview> {
  if (!workspace) return { purpose_preview: "", rules_preview: "" };
  const out: RuleFilesPreview = { purpose_preview: "", rules_preview: "" };
  for (const [rel, key, mtimeKey] of [
    ["purpose.md", "purpose_preview", "purpose_mtime"],
    ["rules.md", "rules_preview", "rules_mtime"],
  ] as const) {
    try {
      const info = await stat(path.join(workspace, rel));
      const data = await readFile(path.join(workspace, rel), "utf8");
      (out as unknown as Record<string, unknown>)[mtimeKey] = Math.floor(info.mtimeMs / 1000);
      (out as unknown as Record<string, unknown>)[key] = truncateUtf8(data.trim(), MAX_RULE_PREVIEW_LEN);
    } catch {
      // ignore missing files
    }
  }
  return out;
}

export async function writeWorkspaceScaffoldsIfMissing(workspace: string): Promise<void> {
  if (!workspace) return;
  await mkdir(path.join(workspace, ".llmwiki"), { recursive: true });
  const files: Record<string, string> = {
    "rules.md": RULES_SCAFFOLD_MD,
    ".llmwiki/prompts.yaml": DEFAULT_PROMPTS_YAML_EXAMPLE,
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(workspace, rel);
    try {
      await stat(full);
    } catch {
      await writeFile(full, content, "utf8");
    }
  }
}

export function languageInstructionForPipeline(lang: string): string {
  if (lang === "zh") {
    return "重要：你必须使用中文撰写所有文档正文。英文术语可以用括号注释，但不允许英文大段正文主导。文档标题、段落、说明文字必须使用中文。";
  }
  if (lang === "en") {
    return "Important: You must write all document content in English. Technical terms may include brief annotations, but no large blocks of non-English text in the main body. Titles, paragraphs, and descriptions must be in English.";
  }
  return "";
}
