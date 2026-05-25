## Context

归档审阅流程（plan → approve → apply）在 analysis/plan/generation 各步使用 `RunToolLoop` 调用 wiki 工具（read/search）。DeepSeek thinking 模式（如 `deepseek-v4-flash`）在 tool call 多轮对话中要求将 assistant 消息的 `reasoning_content` 原样回传；当前 `llm.Message` 无此字段，第二轮即 400，pipeline 降级为无工具 stream。

降级后 LLM 仍可能产出 FILE 块，但路径常使用 plan JSON 中的简写（`entity/foo.md`），而 `ApplyWikiBlocks` 仅接受 `wiki/` 前缀并静默 skip。实测：generation 产出 7 个 FILE 块、`paths_written: null`、review apply `succeeded` 且 `applied 0 wiki page(s)`。

## Goals / Non-Goals

**Goals:**

- Tool loop 与 DeepSeek thinking + tool calls API 契约兼容
- LLM 输出的 typed wiki 路径在写入前规范化到 `wiki/<type-dir>/...`
- 解析到 FILE 块但 0 文件写入时，job/review 明确失败
- 审阅 UI 反映真实写入结果

**Non-Goals:**

- 不支持 reasoning 的模型行为变更（OpenAI o-series 等若需单独字段另议）
- 自动修复已失败归档的历史数据（用户可手动 re-apply/replan）
- 更换 DeepSeek 默认模型或禁用 thinking 模式

## Decisions

### 1. `reasoning_content` 纳入 Message 与 ChatResult

在 `llm.Message` 增加 `ReasoningContent string`，JSON tag `reasoning_content,omitempty`。`parseChatResponse`（OpenAI 兼容分支）从 `choices[0].message.reasoning_content` 解析。`RunToolLoop` 在 append assistant 消息时保留 `ReasoningContent` 与 `ToolCalls`。

**备选**：检测到 DeepSeek 时禁用 tool loop — 简单但损失 read/search 质量。**否决**。

### 2. 路径规范化函数 `NormalizeWikiFilePath`

新增 `ingest.NormalizeWikiFilePath(path string) (string, error)`，在 `parseFileBlocksWithContent` 之后、`ApplyWikiBlocks` 之前调用：

| 输入前缀 | 输出 |
|----------|------|
| 已有 `wiki/` | 不变 |
| `entity/` / `entities/` | `wiki/entities/` + 余下路径 |
| `concept/` / `concepts/` | `wiki/concepts/` |
| `source/` / `sources/` | `wiki/sources/` |
| `synthesis/` | `wiki/synthesis/` |
| `comparison/` / `comparisons/` | `wiki/comparisons/` |
| `query/` / `queries/` | `wiki/queries/` |

无法识别的简写返回 error（供 pipeline 记录），不静默 skip。记录 `step=apply_files, phase=warn` 当发生规范化。

**备选**：仅加强 prompt — 已证明不足（plan 仍输出 `entity/`）。**与规范化并用**。

### 3. 零写入失败语义

`ApplyWikiBlocks` 返回 `(written []string, skipped []string, err error)` 或在调用方检查：若 `len(blocks) > 0 && len(written) == 0`，返回 `errNoWikiFilesWritten`。

`processReviewApplyJob` 与常规 ingest apply 路径在 merge 前检测；失败时 `failReviewApplyFailed`，error_code `no_wiki_files_written`。

Review 不得标 `succeeded`；`merge_commit_sha` 不更新（无变更时不假成功）。

### 4. 提示词补强（次要）

`lockedFormatInstruction(StepGeneration)` 增加一行：`FILE 路径必须以 wiki/ 开头，例如 wiki/entities/Name.md`。Plan JSON 示例统一为 `wiki/entities/...`。

### 5. UI：0 页写入视为失败

`ArchiveReviewCard` 在 review `succeeded` 但 `result_summary` 含 `applied 0` 或 API 返回 `pages_written: 0` 时显示警告/失败态（若后端改为 failed 则走现有 failed 分支）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 规范化误映射罕见路径 | 仅处理已知 typed 前缀；其余返回明确错误 |
| `reasoning_content` 增大 token 用量 | 仅 tool loop 轮次携带；普通 stream 不受影响 |
| 旧缓存 plan JSON 路径仍错 | apply 阶段规范化 + 零写入检测兜底 |
| deepseek-reasoner 禁止传入 reasoning（另一契约） | 按 provider/model 元数据区分；本 change 聚焦 thinking+tools 模型 |

## Migration Plan

1. 部署后端 + 前端
2. 对已「成功但 0 页」的 review：用户可在 UI 重新「确认执行」或「重新规划」
3. 无需 DB schema 变更

## Open Questions

- 是否根据 `provider_models_cache.reasoning` 在 tool loop 前探测并记录模型能力（便于 future 禁用 tools）— 可作为 follow-up，非本 change 阻塞项
