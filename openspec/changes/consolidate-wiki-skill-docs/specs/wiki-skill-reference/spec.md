## ADDED Requirements

### Requirement: 跨实现 Skill 系统对比
文档 SHALL 包含 5 个参考实现的 Skill 系统对比分析，至少覆盖：Skill 文件格式、工作流数量、触发方式、与宿主的交互模型。对比 MUST 以表格形式呈现，便于快速查阅。

#### Scenario: 开发者查阅 Skill 对比
- **WHEN** 开发者打开 `docs/15-llm-wiki-skill-reference.md` 的跨实现对比章节
- **THEN** 能看到 5 个参考实现的 Skill 系统并列对比（名称、格式、工作流数、交互模型、定位）

### Requirement: 本项目三大操作完整工作流
文档 SHALL 详细描述本项目的三大核心操作（Ingest/Query/Lint）的完整工作流，包含步骤分解、工具调用序列、与参考实现的对应关系。

#### Scenario: 理解 Ingest 工作流
- **WHEN** 开发者阅读 Ingest 操作章节
- **THEN** 能看到完整的步骤链（Session Chat → 归档 → 审核 → Apply → 写入 Wiki），每步对应的具体 PromptStep、使用的 Local Tool、以及与 nashsu 两步骤摄入的对比

#### Scenario: 理解 Query 工作流
- **WHEN** 开发者阅读 Query 操作章节
- **THEN** 能看到 QA 模式和 Organize 模式的区分、工具调用顺序（search → read → references → audit/structure）、以及结果归档流程

#### Scenario: 理解 Lint 工作流
- **WHEN** 开发者阅读 Lint 操作章节
- **THEN** 能看到已实现的检查项列表（死链/孤立/frontmatter/错位/日志）、触发方式（MCP search lint 模式 / Local tool audit）、以及与 Karpathy 原始概念的对应

### Requirement: 代码 Prompt 系统设计映射
文档 SHALL 将 9 个 PromptStep（Analysis/Generation/Plan/SessionChat/SessionQA/SessionOrganize/MergeBody/Rollback/PlanOrganize）映射到具体的操作场景和代码位置。

#### Scenario: 理解 Session 模式与 PromptStep 的关系
- **WHEN** 开发者阅读 Prompt 系统映射章节
- **THEN** 能看到 Session 模式（chat/qa/organize）→ PromptStep（SessionChat/SessionQA/SessionOrganize）→ 对应 prompt 内容的完整映射链

### Requirement: 面向 Web UI 用户的使用指导
文档 SHALL 包含面向终端用户（使用 Web UI）的操作指导章节，描述推荐工作流和最佳实践。

#### Scenario: Web UI 用户参考推荐工作流
- **WHEN** 用户阅读推荐工作流章节
- **THEN** 能看到不同使用场景（新建知识库、持续摄入、定期维护、深度问答）的推荐操作路径

### Requirement: 文档使用简体中文
文档 MUST 使用简体中文撰写，技术术语保留英文原文并附中文解释。

#### Scenario: 中文开发者阅读文档
- **WHEN** 中文开发者阅读 `docs/15-llm-wiki-skill-reference.md`
- **THEN** 全文为简体中文，技术术语如 "PromptStep"、"FTS5"、"wikilink" 保留英文并附中文解释
