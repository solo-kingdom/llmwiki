## Why

当前项目在语言层面存在三个问题：

1. **界面文案中英混用**：同一页面出现中文与英文硬编码，用户认知成本高。
2. **缺少统一语言配置**：没有可持久化的“界面语言”和“文档语言”设置。
3. **生成链路语言不可控**：会话归档和其他摄入路径在生成 wiki 文档时，没有显式告知大模型输出指定语言。

作为开源项目，首版需要稳定支持中英文双语，且行为可预期、可测试、可扩展。

## What Changes

- 新增两项全局设置（值域统一为 `zh` / `en`）：
  - `ui_language`：控制前端界面文案语言。
  - `doc_language`：控制所有文档生成链路的目标语言。
- 建立前端最小 i18n 机制，替换关键页面硬编码文案，消除中英混用。
- 在归档和全部生成路径中，将 `doc_language` 显式注入 LLM 提示词，强约束输出语言。
- 增加“语言风格约束”：以所选语言为主，英文仅作为注释/术语补充（尤其在 `zh` 模式）。
- 补齐后端 API、配置读写、前端类型与测试覆盖。

## Scope

### In Scope

- Settings API 增加 `ui_language` 与 `doc_language` 的读取、写入、校验。
- Web 设置页新增“界面语言”和“文档语言”配置项。
- Web UI 关键视图切换到词条翻译机制（首版覆盖导航、设置页、会话页高频文案）。
- `session archive` 以及 `upload/text/conversation/rollback` 等生成路径统一应用 `doc_language`。
- 与语言相关的单元/集成测试补全。

### Out of Scope

- 除中英文外的第三种语言支持。
- 完整覆盖所有历史页面文案（首版聚焦高频与核心流程）。
- 基于用户浏览器自动检测语言并自动切换。

## Product Decisions (Confirmed)

- 语言值域直接使用：`zh` / `en`。
- `doc_language` 不仅作用于会话归档，也作用于全部生成路径。
- 生成文档遵循“设定语言为主、英文为注释”的风格约束（避免中英正文混写）。

## Capabilities

### New Capabilities

- `ui-language-setting`: 用户可在设置中切换界面语言，并即时影响界面文本。
- `doc-language-setting`: 用户可配置文档生成语言，影响所有生成入口。
- `language-governed-generation`: 生成提示词具备显式语言约束与风格约束，输出可预测。

### Updated Capabilities

- `ingest-pipeline`: 生成阶段新增语言参数化提示约束。
- `ingest-chat-ui`: 归档行为与语言设置联动。
- `settings-api`: 增加语言设置键的输入输出和校验。

## Impact

- **Backend**: `internal/api/settings.go`、`internal/ingest/*`、`internal/api/ingest_session.go` 需要新增语言配置透传与提示词策略。
- **Frontend**: `web/src/types.ts`、`web/src/components/SettingsPage.tsx`、`web/src/components/WorkbenchLayout.tsx`、`web/src/components/IngestChat.tsx` 以及新增 i18n 目录。
- **Data**: 复用 `app_config`，新增键值，不改 DB schema。
- **Testing**: 需要扩展 settings API 测试、pipeline prompt 测试、关键 UI 文案渲染测试。

## Risks

- 替换硬编码文案时容易漏改，导致残留混用。
- 语言约束提示过强可能影响模型生成自然度，需要在“强约束”和“可读性”之间平衡。
- 如果 `doc_language` 在任务执行时动态读取，可能导致“提交时语言”和“执行时语言”不一致；需明确策略（建议 job 创建时快照）。
