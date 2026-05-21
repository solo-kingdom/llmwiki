## Context

探索结论已确认：

- 内置 prompt 应**中文化**，并内置「以输入为主、禁止臆造」的 `FidelityInstruction`。
- **Rules** 主存储为工作区文件；**Settings** 仅 `rules_supplement`（追加）。
- 用户自定义 prompt **仅允许 append**，内置 LOCKED 段不可被覆盖。

当前 `internal/ingest/pipeline.go` 等文件内联英文 system 字符串；`purpose.md` 存在但未被读取。`doc_language` 已通过 `languageInstructionForPipeline` 追加，但与探索目标的部分重复，应纳入统一组合器。

## Goals / Non-Goals

**Goals:**

- 单一 `ComposeSystemPrompt(step, PromptContext)` 入口，所有 LLM 步骤一致
- 中文默认模板 + 不可编辑的忠实性与格式契约
- `purpose.md` + `rules.md` 截断注入；`rules_supplement` 与 `prompts.yaml` append
- Settings UI 可编辑 supplement 并预览文件规则摘要
- Job metadata 记录 `rules_hash`

**Non-Goals:**

- 在 Settings 或 DB 存储完整 system prompt
- `replace` 覆盖内置 prompt
- MCP 消费 `rules_supplement`
- index.md / wiki 全文上下文注入（后续 change）

## Decisions

### Decision 1: Prompt 组合优先级（固定，文档化）

```
1. [LOCKED] 格式与安全（FILE 块、路径、no preamble）
2. [LOCKED] FidelityInstruction（以源为准、Open Questions、禁止源外扩写）
3. [DEFAULT] 步骤中文任务模板（analysis / generation / …）
4. [FILE] purpose.md（截断，默认 max 1500 runes/bytes）
5. [FILE] rules.md（截断，默认 max 1500）
6. [FILE] prompts.yaml steps.<step>.append（若存在）
7. [SETTINGS] rules_supplement（≤2048 字符）
8. [RUNTIME] LanguageInstruction(doc_language)
```

用户内容不得插入或替换 1–3。实现时用明确分隔标题包裹 4–7，降低 prompt 注入风险。

### Decision 2: 工作区文件

| 文件 | 职责 | Init |
|------|------|------|
| `purpose.md` | 研究意图（goals, key_questions, scope） | 已有 scaffold；与 fix-workspace-scaffold-zh 对齐中文模板 |
| `rules.md` | 结构/领域/忠实性规则 | **本 change 新增** writeIfNotExists |
| `.llmwiki/prompts.yaml` | 可选 per-step append | 示例 writeIfNotExists（可注释说明 append-only） |

`rules.md` 默认中文 scaffold 含：内容忠实性、引用、页面策略、领域约束占位。

### Decision 3: prompts.yaml schema（append-only）

```yaml
version: 1
steps:
  analysis:
    append: |
      单行或多行补充，仅追加。
  generation:
    append: ""
  session_chat:
    append: ""
  merge_body:
    append: ""
  rollback:
    append: ""
  plan:
    append: ""
```

解析规则：

- 仅识别 `steps.<name>.append`；存在 `replace` 键则忽略并记录 warn（或校验拒绝写入 API）
- 未知 step 名忽略
- 文件缺失视为无 append

### Decision 4: Settings `rules_supplement`

- 键名：`rules_supplement`
- 存储：`app_config` 字符串，默认 `""`
- 校验：UTF-8 长度 ≤ 2048；GET/PUT `/api/v1/settings` 纳入 `settingsResponse`
- UI：Settings「Wiki 规则」卡片 — 文件预览（只读 API）+ supplement 文本框
- **不**通过 Settings 修改 `purpose.md` / `rules.md` 正文（首期）

新增可选 API（首期二选一，tasks 中实现 preview 即可）：

- `GET /api/v1/workspace/rule-files` 返回 `{ purpose_preview, rules_preview, purpose_mtime, rules_mtime }` 各截断 500 字

### Decision 5: 中文默认模板（示意）

**analysis**（DEFAULT 段）要点：结构化分析实体/概念/论点/连接/矛盾；紧扣源文档；不确定标「待证实」。

**generation**（DEFAULT 段）要点：基于原文+分析产出 FILE 块；禁止源外事实与长篇背景；直接 `---FILE:` 开头。

**session_chat**：探索助手；以用户消息与附件为准；不编造事实。

**attachment summary**：仅总结提取文本；中文；字数上限保留现有逻辑。

**rollback**：根据 diff 与源内容恢复；FILE/DELETE 块格式。

用户消息框架中文化：`源文件`、`分析（仅供参考）`、`原始内容` 等。

### Decision 6: FidelityInstruction（LOCKED，中英文各一版随 doc_language）

`doc_language=zh` 时内置（大意，实现时写完整句）：

- 以原始源与已有 wiki 为依据；不得引入源中未支持的事实、背景科普或模型常识扩写
- 无依据推断写入 Open Questions
- 更新已有页面时仅补充与本次源相关的新信息

`doc_language=en` 时提供对称英文 LOCKED 段。

### Decision 7: rules_hash 快照

Job 创建时（processor enqueue）计算：

```
SHA256(purpose.md content + rules.md content + rules_supplement + canonical prompts.yaml)
```

写入 job metadata JSON 字段 `rules_hash`（若已有 metadata 结构则扩展）。执行时可选：hash 与当前不一致时 `ingest_job_events` 记录 `rules_drift` 信息级事件，不阻断执行（首版）。

### Decision 8: 代码结构

```
internal/ingest/
  prompts.go       # ComposeSystemPrompt, LoadWorkspaceRules, LoadPromptAppends, FidelityInstruction
  prompts_test.go
```

`languageInstructionForPipeline` 迁入或委托 `prompts.go`，避免与 `internal/api/settings.go` 的 `LanguageInstruction` 重复 — 优先 ingest 包调用 api 包函数或抽到 `internal/llmwiki/lang`（首版 ingest 调用 api.LanguageInstruction 即可）。

### Decision 9: 与 add-wiki-page-templates 的衔接

若 templates change 已合并，`ComposeSystemPrompt` 在 step=generation 时于 LanguageInstruction 之前追加 `templateGuidanceForGeneration(docLang)`。本 change 实现时预留 hook `appendGenerationGuidance(sb)`。

## Risks

| 风险 | 缓解 |
|------|------|
| Token 超限 | purpose/rules 各 1500 截断；supplement 2048 上限 |
| 规则冲突 | 文档 + UI 优先级说明 |
| 测试脆弱（全文匹配） | 断言 LOCKED 关键字与子串，非全文快照 |
| purpose 为空 | 跳过空文件段，不注入 |

## Migration

- 已有 workspace：init repair / `llmwiki init` 补 `rules.md` 与示例 `prompts.yaml`，不覆盖用户已编辑的 `purpose.md`
- 无 `rules_supplement` 键时 GET 返回 `""`
