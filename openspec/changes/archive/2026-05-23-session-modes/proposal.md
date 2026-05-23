## Why

当前 Chat 会话只有一种模式——"摄入前对话助手"，所有 session 使用相同的系统提示词、工具集和归档行为。随着 wiki 页面增长，三种高频需求无法被单一模式满足：

1. **结构乱了需要整理**：wiki 页面越来越多，出现孤立页、死链、重复内容、分类不一致等问题，用户需要 Agent 能诊断并帮助重组。当前 Agent 只有 search/read，无法做结构分析和内容比对。

2. **基于 wiki 内容的问答**：用户经常想直接问"wiki 里关于 X 说了什么"，期望 Agent 从已有知识库检索并回答。当前 Agent 被设计为"摄入前助手"，人格和行为偏向新内容生成，不适合纯问答场景。

3. **对话中需求变化**：用户可能在同一个会话中先问问题（QA），发现结构问题后切换到整理模式，讨论清楚后归档。当前系统无法在对话中途切换 Agent 的人设和能力。

## What Changes

- **Session Mode 概念**：在 `ingest_sessions` 表新增 `mode` 字段（`ingest` / `qa` / `organize`），默认 `ingest`（向后兼容）
- **Mode 可切换**：通过 API 在对话中途切换模式，无需新建 session
- **模式驱动的三元组**：每种 mode 决定（1）系统提示词（2）可用工具集（3）tool loop 参数
- **新增只读诊断工具**（organize 模式专用）：`audit`（综合健康检查）、`structure`（目录结构）、`gaps`（覆盖缺口）、`similar`（相似内容发现）
- **工具混合实现策略**：Go 代码做机械检查（复用 lint/FTS/图查询），LLM Agent 做语义判断（读内容后分析建议）
- **管道感知 mode**：archive markdown 带 `session_mode` 字段，ingest pipeline 的 plan 阶段按 mode 使用不同提示词
- **前端 mode 选择器**：SessionControls 中新增模式切换 UI

## Capabilities

### New Capabilities

- `session-modes`: Session 级别的模式系统，支持 ingest / qa / organize 三种模式及其运行时行为
- `diagnostic-tools`: 只读诊断工具集（audit / structure / gaps / similar），用于 wiki 健康检查和结构分析

### Modified Capabilities

- `ingest-session-api`: 创建 session 支持 mode 参数；新增 PATCH mode 切换端点
- `ingest-chat-ui`: 新增 mode 选择器；按 mode 显示不同视觉提示
- `ingest-pipeline`: plan 阶段读取 archive 的 session_mode，按 mode 选择提示词
- `mcp-server`: `BuiltinReadonlyToolDefinitions` 按模式返回不同工具集

## Impact

- **数据库**: `ingest_sessions` 表新增 `mode` 列（TEXT DEFAULT 'ingest'），需 migration
- **后端 Go**: `internal/store/sqlite/`（model + SQL）、`internal/api/ingest_session.go`（API）、`internal/ingest/`（prompt/tool routing）、`internal/mcp/local_tools.go`（新工具）
- **摄入管道**: `internal/ingest/prompts.go`（新增 prompt step）、`internal/ingest/pipeline.go`（识别 mode）
- **前端**: `types.ts`、`api.ts`、`AppContext.tsx`、`SessionControls.tsx`、`IngestChat.tsx`

## Non-Goals

- 不在本变更中引入除 ingest/qa/organize 之外的模式（如翻译、摘要等）
- 不让 chat agent 直接写 wiki（所有修改仍走 archive → pipeline 路径）
- 不改变 archive → review → plan → generate 的主流程结构
- 不新增数据库表（仅新增列）
- 不在管道中为不同 mode 创建独立的 pipeline 实现（复用现有管道，仅切换提示词）
