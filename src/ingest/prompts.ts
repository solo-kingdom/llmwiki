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

- 默认创建 source / entity / concept 类页面
- 可复用经验、踩坑与排查模式归入 experience（kind: practice | pitfall | pattern、status: draft | validated | deprecated；pitfall/pattern 需写 symptoms 现象词）
- 业务对象当前状态与追加历史归入 ledger（status 必填）
- 除非源中明确存在综合论述，否则不要创建 synthesis 页面

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
- FILE 路径必须以 wiki/ 开头，例如 wiki/entities/Page.md（禁止使用 entity/Page.md 等简写）
- 回复必须以 ---FILE: 开头，不要任何前言、解释或 markdown 代码围栏包裹整段输出
- 需要删除文件时：---FILE: path
---DELETE---
---END FILE---`;
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
      return `你是一名知识分析师。请基于用户提供的源文档做结构化分析，先区分实体、概念、关系，再规划页面：
- 实体（entity）：可唯一指代的具体对象，如人、组织、产品、项目
- 概念（concept）：可跨对象复用的术语、方法、框架、机制、理论
- 关系（relation）：实体与概念之间的案例、采用、提出、体现关系
- 关键论点、与已有 wiki 的可能连接、源内矛盾或张力、建议页面结构

对每个候选短语，分别列出实体候选、概念候选和关系候选。若短语形如「实体名 + 抽象概念」（如「AppLovin组织裁剪方法论」），应拆为实体 AppLovin、概念 组织裁剪方法论，以及它们之间的案例关系，不要当作单个概念页。

你可以使用 search 工具搜索已有 wiki 页面，使用 read 工具读取页面全文。分析时应明确区分：哪些知识已有页面覆盖（建议 update），哪些是新知识（建议 create）。优先建议 update 已有页面。

搜索时不要只查一次精确词：对关键实体/概念尝试别名、缩写、中文/英文变体或更宽泛关键词。摄入前留意隐私和敏感信息；如材料明显包含凭据、个人隐私或超出 purpose.md 范围的内容，应在分析中提示。

要求：分析必须紧扣源文档；不确定的内容标注为「待证实」，不要当作事实。`;
    case "generation":
      return `你是 wiki 页面生成器。根据用户消息中的「原始内容」与「分析结果」生成 wiki 页面（FILE 块）。
- 以原始内容为首要依据；分析结果仅作组织参考
- 不要添加源中未支持的内容
- 业务知识页按知识主题组织在 wiki/ 下的多级目录中（如 wiki/AI工程/Agent/harness.md），不得写入 wiki/ 顶层
- 优先复用提示中提供的已有目录；仅在无合适主题目录时新建浅层目录（建议 2–3 层）
- 必须在 YAML frontmatter 中准确填写 \`type:\`（entity / concept / synthesis / comparison / query / experience / ledger / source）与 \`confidence:\`（high / medium / low）
- 若为 experience，需填写 kind: practice | pitfall | pattern 与 status: draft | validated | deprecated；pitfall / pattern 需填写 symptoms 现象检索词；ledger 需填写 status
- 凭据、密钥、个人联系方式、内部主机名统一脱敏为 <REDACTED>
- 如果摄入来自文件、URL 或大段文本，应创建或更新 wiki/sources/ 下的 source 摘要页
- 每个新增事实都应能追溯到 source 摘要、原始内容或已有 wiki 页面
- 遇到新旧事实冲突时保留冲突上下文，写入 Open Questions 或明确标注不确定性
- 概念页标题默认保持中性，不要把具体实体名焊进概念标题；实体与概念通过 wikilink 关联
- 若候选概念标题形如「实体名 + 方法/模型/文化/框架/策略/机制/理论/实践」等，应优先创建中性概念页（如 wiki/组织管理/组织裁剪方法论.md），并在正文中链接实体页（如 [[AppLovin]]）作为案例
- 仅当源材料明确把整体短语当作固定专有名词时，才保留组合标题，并在正文说明命名依据

你可以使用 read 工具读取已有 wiki 页面的当前内容。对于已有页面，生成的内容应保留原有信息并增量补充新内容。不要删除已有页面中的重要段落，除非源文档明确否定。`;
    case "plan":
      return `你是 wiki 摄入规划师。请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON：{"summary":"...","changes":[{"path":"wiki/entities/Example.md","action":"create|update","rationale":"..."}]}
仅规划，不写文件。计划中应说明 source 摘要页、实体/概念页、交叉引用和潜在冲突如何处理。

你可以使用 search 工具搜索已有 wiki 页面，使用 read 工具读取页面全文。工具探索应控制在必要范围；信息足够后必须输出 plan，不要无限调用工具。`;
    case "plan_organize":
      return `你是 wiki 重组规划师。本次归档来自「整理模式」对话，用户的意图是重组和优化已有 wiki 页面。
请产出：
1) 人类可读的计划（Markdown：将改什么、为什么）
2) 围栏代码块中的 JSON，格式如下：
{"summary":"...","changes":[
  {"path":"wiki/entities/Example.md","action":"update","rationale":"..."},
  {"path":"wiki/concepts/New.md","action":"move","from_path":"wiki/concepts/Old.md","to_path":"wiki/concepts/New.md","rationale":"重命名"},
  {"path":"wiki/concepts/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/concepts/Merged.md","rationale":"合并重复"}
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
2) 围栏代码块中的 JSON：{"summary":"...","changes":[{"path":"wiki/concepts/Example.md","action":"update","rationale":"..."},{"path":"wiki/concepts/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/concepts/Merged.md","rationale":"合并重复页面"}]}

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
      return `You are a knowledge analyst. Analyze the source document by first separating entities, concepts, and relations, then plan pages:
- entity: a uniquely identifiable concrete object such as a person, organization, product, or project
- concept: a reusable term, method, framework, mechanism, or theory
- relation: a case, adoption, or embodiment link between an entity and a concept
- key arguments, connections to existing wiki pages, contradictions, and structural recommendations

For each candidate phrase, list entity candidates, concept candidates, and relation candidates separately. If a phrase looks like "entity name + abstract concept" (e.g. AppLovin组织裁剪方法论), split it into entity AppLovin, concept 组织裁剪方法论, and their case relationship instead of treating it as one concept page.

You can use the search tool to find existing wiki pages and the read tool to read page content. Clearly distinguish: which knowledge is already covered by existing pages (suggest update), and which is new (suggest create). Prefer suggesting updates to existing pages.

Do not rely on a single exact search. For key entities and concepts, try aliases, abbreviations, English/Chinese variants, or broader terms. Before ingestion, flag obvious credentials, private information, or material outside purpose.md scope.`;
    case "generation":
      return `You are a wiki generator. Produce wiki pages from the original content and analysis in FILE blocks. The source is authoritative; analysis is organizational context only.
- Business pages MUST be placed inside topic folders under wiki/ (e.g. wiki/AI-Engineering/Agent/harness.md), NOT as top-level wiki/*.md files.
- Prefer reusing existing folders listed in the prompt; only create new shallow topic folders (2-3 levels max) when no existing folder fits.
- Always set frontmatter \`type:\` accurately (entity / concept / synthesis / comparison / query / experience / ledger / source) and \`confidence: high | medium | low\`.
- For experience, include kind: practice | pitfall | pattern and status: draft | validated | deprecated (plus symptoms for pitfall/pattern); for ledger, include status.
- Redact credentials, secrets, personal contacts, and internal hostnames as <REDACTED>.

If ingestion comes from a file, URL, or substantial text, create or update a source summary under wiki/sources/. Every new fact should trace to a source summary, source content, or existing wiki page. If new and old facts conflict, preserve the conflict context and mark uncertainty instead of silently overwriting.

Concept page titles should stay neutral by default; do not embed concrete entity names in concept titles. Link entities and concepts via wikilinks. If a candidate concept title looks like "entity name + method/model/culture/framework/strategy/mechanism/theory/practice", prefer a neutral concept page and link the entity page (e.g. [[AppLovin]]) as a case in the body. Only keep a combined title when the source clearly treats the full phrase as a fixed proper term, and explain that basis in the body.

You can use the read tool to read the current content of existing wiki pages. For existing pages, your output should preserve original information and incrementally add new content. Do not remove important paragraphs from existing pages unless the source explicitly contradicts them.`;
    case "plan":
      return `You are a wiki ingest planner. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. Planning only — no FILE blocks. The plan should mention source summaries, entity/concept pages, cross-links, and potential conflicts.

You can use search to find existing wiki pages and read to load page content. Keep tool exploration to what is necessary; once you have enough context, output the plan — do not call tools indefinitely.`;
    case "plan_organize":
      return `You are a wiki reorganization planner. This archive is from an "organize mode" session where the user intended to restructure existing wiki pages. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. The JSON schema supports:
{"summary":"...","changes":[
  {"path":"wiki/entities/Example.md","action":"update","rationale":"..."},
  {"path":"wiki/concepts/New.md","action":"move","from_path":"wiki/concepts/Old.md","to_path":"wiki/concepts/New.md","rationale":"rename"},
  {"path":"wiki/concepts/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/concepts/Merged.md","rationale":"deduplicate"}
]}

For move actions, fill in from_path (old path) and to_path (new path). For merge actions, fill in source_paths (all source pages) and to_path (merged destination). Focus on update/move/merge rather than create. Preserve important existing content. If audit/lint reports entity_concept_coupling, plan to rename entity-bound concept pages to neutral concepts and update wikilinks. Planning only — no FILE blocks.

You can use structure, audit, search, read, and related tools to understand the wiki. Keep tool exploration to what is necessary; once you have enough context, output the plan — do not call tools indefinitely.`;
    case "plan_qa":
      return `You are a wiki knowledge consolidation planner. This archive is from a "QA mode" session where the user explored existing wiki content through questions. Output a human-readable Markdown plan and a fenced JSON block with summary and changes. The JSON schema supports update and merge actions: {"summary":"...","changes":[{"path":"wiki/concepts/Example.md","action":"update","rationale":"..."},{"path":"wiki/concepts/Merged.md","action":"merge","source_paths":["wiki/concepts/A.md","wiki/concepts/B.md"],"to_path":"wiki/concepts/Merged.md","rationale":"deduplicate"}]}. For merge actions, fill in source_paths (all source pages) and to_path (merged destination). Focus on updating existing pages with new insights or corrections from the Q&A. If duplicate or highly similar pages are found, use the merge action. If an answer is worth preserving as an artifact, plan a wiki/queries/ page or update the relevant topic page. Only create new pages if genuinely needed. Planning only — no FILE blocks.

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
