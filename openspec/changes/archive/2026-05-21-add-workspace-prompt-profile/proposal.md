## Why

当前 ingest 相关 LLM 提示词存在三类问题：

1. **语言不一致**：system prompt 以英文为主，仅通过 `doc_language` 追加片段约束中文，模型易混语或忽略约束。
2. **行为不可配置**：`purpose.md` 已在 init 中 scaffold，但 pipeline 未读取；用户无法在 Settings 或工作区文件中表达领域规则。
3. **输出易扩写**：缺少「以输入为主、禁止臆造」的硬性约束，生成内容可能超出源材料范围。

参考 docs 综合结论与 LLM-Wiki-Skilled / nashsu 实践：Wiki 语义配置应**文件为主**（Git 可协作），Settings 仅承载**短文本追加**；提示词自定义**只允许 append**，不得替换内置安全契约。

## What Changes

- 新增集中式 `ComposeSystemPrompt(step, ctx)`，按固定优先级拼接 LOCKED 内置段、工作区文件、可选 append 配置与 Settings supplement。
- 将 analysis / generation / session_chat / merge_body / rollback 等路径的默认 system prompt **全面中文化**，并内置 `FidelityInstruction`（内容忠实性）。
- 新增工作区 `rules.md` scaffold（writeIfNotExists）；pipeline 读取 `purpose.md` + `rules.md`（截断注入）。
- 新增可选 `.llmwiki/prompts.yaml`，仅支持 per-step `append` 字段。
- Settings 新增 `rules_supplement`（≤2048 字符），追加在文件规则之后；Web Settings 提供预览与编辑。
- Job 创建时快照 `rules_hash` 到 metadata，便于追溯执行时规则版本。
- 补齐 prompt 组合与 settings API 测试。

## Scope

### In Scope

- `internal/ingest/prompts.go`（或等价包）统一 prompt 构建
- `rules.md` init/repair scaffold
- `purpose.md` / `rules.md` 截断读取（各默认 ≤1500 字符）
- `.llmwiki/prompts.yaml` 解析（append-only schema）
- `rules_supplement` in `app_config` + Settings API/UI
- 覆盖路径：pipeline analysis/generation、review plan/generation、session_chat、attachment summary、rollback
- 中文用户消息标签（源文件/分析/原文等）

### Out of Scope

- Settings 内嵌大文件编辑器（`purpose.md` / `rules.md` 仍通过 Obsidian/外部编辑）
- Prompt 整段 `replace` 或覆盖内置 LOCKED 段
- MCP Agent 读取 `rules_supplement`（Agent 改 `rules.md`）
- `wiki/index.md` 全文注入（可后续单独 change）
- 完整 Required Sections lint

## Product Decisions (Confirmed)

- **Rules 主存储**：`purpose.md` + `rules.md`（工作区文件）。
- **Settings**：仅 `rules_supplement`，追加生效，≤2048 字符。
- **Prompts 自定义**：`.llmwiki/prompts.yaml` 与各路径仅 **append**，禁止 replace 内置 system。
- **内置核心不可编辑**：FILE 块格式、路径安全、禁止 preamble、FidelityInstruction。

## Capabilities

### New Capabilities

- `workspace-prompt-profile`: 工作区规则文件 + append-only 提示词配置 + 集中式 prompt 组合

### Modified Capabilities

- `ingest-pipeline`: 两步骤及 review 路径使用组合 prompt；中文默认与忠实性约束
- `workspace-management`: init/repair 写入 `rules.md`；可选 `prompts.yaml` 示例
- `ingest-session-api` / `ingest-chat-ui`: 会话 system prompt 与附件摘要中文化
- `rollback-job`: 回滚 prompt 纳入组合器
- `web-ui`: Settings「Wiki 规则」卡片（supplement + 文件预览）

## Dependencies

- 建议与 `fix-workspace-scaffold-zh` 协调：`purpose.md` 中文 scaffold 与本 change 读取逻辑一致
- 不与 `add-wiki-page-templates` 冲突；模板章节注入排在组合器末尾（未来合并时保持优先级）

## Impact

- **Backend**: `internal/ingest/prompts.go`（新）、`pipeline.go`、`pipeline_review.go`、`session_chat.go`、`rollback.go`、`internal/api/settings.go`、`cmd/llmwiki/init.go`
- **Frontend**: `SettingsPage.tsx`、`types.ts`、i18n 词条
- **Data**: `app_config` 新增 `rules_supplement`；ingest job metadata 可选 `rules_hash`
- **Testing**: prompt 组合单测、settings API 测试、pipeline 断言中文与忠实性关键字

## Risks

- 多段 append 导致 token 过长：通过截断与 supplement 长度上限缓解
- 用户 supplement 与 rules.md 冲突：UI 标明优先级（文件 < yaml append < supplement）
- 执行时 Settings 变更导致行为漂移：`rules_hash` 快照 + 日志
