## Context

本项目是一个 Go 单二进制的 LLM Wiki 系统，已有三套文档/提示体系：

1. **代码内 Prompt 系统**（`internal/ingest/prompts.go`）：9 个 PromptStep，按步骤分发中英文 prompt，包含 `purpose.md` + `rules.md` 叠加机制
2. **Web UI Help 页面**（`web/src/content/help.zh.md` / `help.en.md`）：面向终端用户的简明指南，131 行，覆盖基本操作
3. **MCP Guide 工具**（`internal/mcp/tools.go`）：面向 LLM Agent 的简要说明，返回工作区文件列表和工具清单

同时，我们有 5 个参考实现的 Skill 系统：
- **llm-wiki-skill**（Claude Code）：1 个 1133 行的 SKILL.md，10 个工作流，最全面
- **LLM-Wiki-Skilled**（OpenCode）：3 个独立 skill（ingest/query/lint），简洁
- **OmegaWiki**（Claude Code）：29 个 skill，学术研究特化
- **nashsu/llm_wiki**（Tauri 桌面应用）：内置 LLM 引擎，无 Skill 文件
- **lcasastorian/llmwiki**（Python Web 平台）：MCP 5 工具集

## Goals / Non-Goals

**Goals:**
- 创建一份全面的 `docs/15-llm-wiki-skill-reference.md`，整合 5 个参考实现的 Skill 设计精华
- 文档需包含：跨实现 Skill 系统对比、本项目三大操作的完整工作流、代码 prompt 系统的设计映射
- 扩充 Web UI Help 页面（中英双语），增加核心工作流使用指导
- 确认 `docs/14-gap-analysis-and-roadmap.md` 的已实现状态更新完整

**Non-Goals:**
- 不新增 `.opencode/skills/` 下的 Skill 文件（本项目的 LLM 通过代码内 prompt 驱动，不通过 SKILL.md）
- 不修改代码逻辑、API 接口或数据库 schema
- 不改变 MCP 工具集或 prompt 系统的行为
- 不创建新的 Web UI 页面或组件

## Decisions

### 决策 1：写一个综合文档而非拆分多个 Skill

**选择**：在 `docs/` 下创建一个 `15-llm-wiki-skill-reference.md` 综合参考文档

**理由**：
- 本项目的 LLM 不是通过读取 SKILL.md 文件工作的（区别于 LLM-Wiki-Skilled 和 OmegaWiki），而是通过 `ComposeSystemPrompt()` 按步骤分发 prompt
- 代码 prompt 系统已经按 9 个 PromptStep 拆分，无需再用 Skill 文件重复这个结构
- 一个综合文档更适合作为：代码 prompt 设计参考 + Web UI Help 内容来源 + 开发者全景理解

**替代方案（不采纳）**：
- 在 `.opencode/skills/` 下创建 4 个独立 Skill（guide/ingest/query/lint）→ 不适合，因为本项目的 LLM Agent 通过 MCP 工具和代码 prompt 工作，不通过 Skill 文件
- 创建一个类似 llm-wiki-skill 的 1000+ 行 SKILL.md → 过度，本项目不需要 SKILL.md 来驱动 Agent 行为

### 决策 2：从参考实现中提取精华而非照搬

**选择**：以本项目的架构和工具体系为骨架，从参考实现中提取设计模式和工作流步骤作为参考

**提取重点**：
| 来源 | 提取内容 |
|------|----------|
| llm-wiki-skill | 工作流路由表设计、触发词映射、别名展开、隐私自查、内容分级处理 |
| LLM-Wiki-Skilled | 极简 Skill 结构（3 个）、严格的 Done Criteria、Guardrails 模式 |
| OmegaWiki | 复杂实体类型系统（仅作参考不采纳）、双向链接不变量、置信度标注 |
| nashsu | 两步骤摄入、4 信号相关性模型、页面合并保护三层（已采纳） |
| lcasastorian | MCP 5 工具集、引用图引擎、陈旧性传播（已采纳） |

### 决策 3：Help 页面扩充聚焦于核心工作流

**选择**：在 Help 页面增加 3 个核心部分：
1. **摄入工作流详解**：Session 模式（chat/qa/organize）、对话→归档→审核流程
2. **Wiki 健康检查**：Lint 操作说明（通过 MCP 或 API 触发）、检查项列表
3. **工作流推荐**：不同使用场景的最佳实践路径

**不扩充**：CLI 命令列表、MCP 接入细节（已有且足够）

### 决策 4：简体中文为主，英文同步

**选择**：`docs/15-llm-wiki-skill-reference.md` 使用简体中文；Help 页面中英文双语同步更新

**理由**：与现有 `help.zh.md` / `help.en.md` 双语体系一致；`docs/` 下的设计文档已全面使用中文。

## Risks / Trade-offs

- **[文档维护成本]** → 新增的 skill-reference.md 可能随功能迭代而过时。缓解：文档中明确标注"本文描述截至 YYYY-MM 的实现状态"，并在 Gap analysis 路线图中标注需同步更新
- **[Help 页面体积]** → 扩充后 Help 页面可能变长。缓解：保持 TOC 目录结构清晰，新增内容使用折叠或分节
- **[与代码 Prompt 不一致]** → 文档描述的工作流可能与实际 `prompts.go` 中的 prompt 行为有偏差。缓解：文档中映射具体的 PromptStep 和 Local Tool，方便交叉验证
