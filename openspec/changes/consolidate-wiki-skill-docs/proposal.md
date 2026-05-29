## Why

项目已有完善的代码内 prompt 系统（`internal/ingest/prompts.go`，9 个 PromptStep，中英双语）和 Web UI Help 页面（`web/src/content/help.zh.md`），但缺少一份**面向 Web UI 用户的全面操作参考文档**。同时，5 个参考实现（llm-wiki-skill、LLM-Wiki-Skilled、OmegaWiki、nashsu/llm_wiki、lcasastorian/llmwiki）的 Skill 设计精华散落在各处，未被系统性地提炼和借鉴。

具体问题：
1. 当前 `help.zh.md` 仅 131 行，覆盖快速开始、CLI、MCP 等操作面，但对核心工作流（摄入、查询、问答、整理、Lint）缺乏深入的使用指导
2. 代码 prompt 系统的设计意图（为何有 9 个步骤、Session 模式如何区分、工具调用顺序等）没有文档化，新开发者难以理解
3. 参考实现的 Skill 知识（llm-wiki-skill 的 10 个工作流路由、OmegaWiki 的 29 个 skill、LLM-Wiki-Skilled 的 3 个 skill）未被整合为本项目可借鉴的设计资产
4. Gap analysis 文档（`docs/14-gap-analysis-and-roadmap.md`）中的已实现状态已过时，需要同步更新

## What Changes

- **新增 `docs/15-llm-wiki-skill-reference.md`**：综合 5 个参考实现的 Skill 设计精华，结合本项目架构，形成一份全面的 LLM Wiki 操作参考文档（简体中文）。包含：跨实现的 Skill 系统对比、本项目三大核心操作（Ingest/Query/Lint）的完整工作流描述、代码 prompt 系统的设计映射、面向 Web UI 用户的使用指导
- **更新 `web/src/content/help.zh.md` 和 `help.en.md`**：扩充核心工作流部分，增加 Session 模式说明、Lint 使用指导、常见工作流推荐，从 skill-reference 中提取面向用户的内容
- **更新 `docs/14-gap-analysis-and-roadmap.md`**：同步 P0-4（SHA256 缓存）的已实现状态（已在本次对话中完成部分更新，需确认完整性）

## Capabilities

### New Capabilities
- `wiki-skill-reference`: 综合参考文档，整合 5 个实现的 Skill 设计精华，描述本项目三大操作的完整工作流，映射代码 prompt 系统的设计意图

### Modified Capabilities
- `help-page`: 扩充 Web UI Help 内容，增加核心工作流使用指导、Session 模式说明、Lint 操作指引

## Impact

- **新增文件**: `docs/15-llm-wiki-skill-reference.md`（约 500-800 行）
- **修改文件**: `web/src/content/help.zh.md`、`web/src/content/help.en.md`、`docs/14-gap-analysis-and-roadmap.md`
- **无代码变更**: 本次变更仅涉及文档和 Web UI 内容，不影响后端逻辑或 API
- **无 breaking change**: Help 页面内容更新不影响任何功能行为
