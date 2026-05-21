## Context

当前系统有三条与语言相关的主链路：

1. **UI 展示链路**：前端组件直接硬编码文案，缺少统一翻译层。
2. **配置链路**：通过 `app_config` 存储 key/value，`/api/v1/settings` 负责读写。
3. **生成链路**：归档与 ingest pipeline 使用固定提示词，语言未参数化。

为了在不引入高复杂度依赖的前提下实现首版双语，本设计采用“最小 i18n + 后端语言策略集中化”。

## Goals / Non-Goals

**Goals**

- 提供 `ui_language` / `doc_language` 两个持久化设置，值域为 `zh` / `en`。
- 让界面文本可根据 `ui_language` 统一切换。
- 让全部生成路径根据 `doc_language` 明确控制输出语言。
- 保持现有架构（Go + React）低侵入改造。

**Non-Goals**

- 不引入复杂国际化平台（如在线翻译管理系统）。
- 不做多租户级别的语言策略隔离。
- 不做历史文档自动语言迁移。

## Architecture

```text
┌────────────────────────┐
│      Settings UI       │
│ ui_language / doc_lang │
└──────────┬─────────────┘
           │ PUT /api/v1/settings
           ▼
┌────────────────────────┐
│   app_config (kv)      │
│ ui_language=zh|en      │
│ doc_language=zh|en     │
└───────┬────────────────┘
        │ read
        ├───────────────────────────────┐
        ▼                               ▼
┌──────────────────────┐         ┌──────────────────────┐
│ Frontend I18n Layer  │         │ Generation Language  │
│ t(key, ui_language)  │         │ Prompt Builder       │
└──────────────────────┘         └──────────┬───────────┘
                                            ▼
                                 all generation entrypoints
```

## Key Decisions

### Decision 1: 语言值域使用 `zh` / `en`

- 与用户要求一致，避免 `zh-CN` / `en-US` 的额外映射层。
- 后端统一做白名单校验，不合法值回退默认值。

### Decision 2: 文档语言覆盖全部生成路径

统一作用于：

- 会话归档生成（session archive）
- 文件上传生成（upload）
- 文本/对话摄入生成（text/conversation ingest）
- 回滚重生成（rollback）

实现方式：在生成提示词构建器中集中注入 `doc_language` 规则，而不是在每个 handler 重复拼接。

### Decision 3: 语言风格策略

- `doc_language=zh`：中文为主，英文术语允许括号注释，不允许英文大段正文主导。
- `doc_language=en`：英文为主，允许必要术语注释，不允许中文大段正文主导。

该策略写入 system prompt 和 user prompt 约束，保证模型行为可控。

### Decision 4: 前端首版采用轻量 i18n

- 新增本地词典文件（`zh` / `en`）。
- 通过 `I18nProvider + t()` 读取词条。
- 首版先覆盖高频核心页面，后续增量迁移其余组件。

## Detailed Design

### 1) Settings API 与配置存储

- `internal/api/settings.go`
  - `settingsResponse` 新增 `ui_language` / `doc_language`。
  - `allowedKeys` 新增这两个 key。
  - 增加值校验函数：仅允许 `zh` / `en`。
  - 空值或非法值按默认处理（`ui_language=zh`, `doc_language=zh`）。
- `internal/store/sqlite/app_config.go`
  - 无需 schema 变更，沿用现有 KV 读写。
- `web/src/types.ts`
  - `Settings` 类型新增字段。

### 2) 前端 i18n 结构

- 新增：
  - `web/src/i18n/messages/zh.ts`
  - `web/src/i18n/messages/en.ts`
  - `web/src/i18n/index.ts`（`t()` 与类型定义）
  - `web/src/context/I18nContext.tsx`（可与 AppContext 组合）
- Settings 页新增两个下拉框：
  - 界面语言（`zh`/`en`）
  - 文档语言（`zh`/`en`）
- `WorkbenchLayout` / `SettingsPage` / `IngestChat` 优先替换硬编码文案。

### 3) 生成提示词语言化

- 目标修改点：
  - `internal/ingest/pipeline.go`（analysis/generate prompts）
  - `internal/ingest/session_chat.go`（会话系统提示）
  - `internal/api/ingest_session.go`（附件摘要提示）
  - `internal/ingest/rollback.go`（回滚提示）
- 增加统一函数（示意）：
  - `ResolveDocLanguage(db)` -> `zh|en`
  - `LanguageInstruction(docLang)` -> prompt 片段
- 将语言规则作为显式文本注入 system prompt，避免隐式默认。

### 4) 一致性与可追溯性策略

建议在 job 创建时将 `doc_language` 写入 job metadata（或 source_ref 扩展），避免“排队后改设置导致执行语言漂移”。

若首版不引入 metadata 字段，则需在 design 中明确：当前按“执行时配置”生效，并记录为后续改进项。

## Testing Strategy

- **API Tests**
  - `settings` 读写 `ui_language` / `doc_language` 成功。
  - 非法值返回 400 或回退逻辑符合预期。
- **Frontend Tests**
  - 切换 `ui_language` 后关键页面文案发生变化。
  - 设置保存后刷新页面仍保留选择。
- **Pipeline/Prompt Tests**
  - `doc_language=zh` 时 prompt 含中文主导约束。
  - `doc_language=en` 时 prompt 含英文主导约束。
  - 会话归档与非会话生成路径均覆盖。

## Risks / Trade-offs

- **最小 i18n 的维护成本**：短期快，长期可能需要迁移到更强工具链。
- **提示词约束强度**：过强会损失表达自然度，过弱会出现混语输出。
- **路径覆盖完整性**：若遗漏某条生成路径，最终行为会不一致。
