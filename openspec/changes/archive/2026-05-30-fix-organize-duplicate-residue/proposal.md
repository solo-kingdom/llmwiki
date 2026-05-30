## Why

整理模式（organize mode）归档后，被替换的旧文件残留为重复页面。例如 `A_Player文化.md` 被重命名为 `A Player文化.md`，但旧文件未被删除；`AppLovin组织裁剪方法论.md` 被拆分为中性概念 `组织裁剪方法论.md`，旧文件仍然存在。根本原因是整理归档管线中 Plan→Apply 阶段缺乏 move/merge 动作的源文件清理机制，且 Plan JSON schema 无法表达重命名/合并的源路径信息。同时 lint 系统缺少重复页面检测能力，无法在事后发现此类残留。

## What Changes

- 扩展 `StepPlanOrganize` / `StepPlanQA` 的 Plan JSON schema，增加 `from_path`、`to_path`、`source_paths` 字段，让 move/merge 动作能明确表达源文件与目标文件
- 在 `generateFromPlan()` 中增加 post-apply cleanup：解析 plan JSON 提取 move/merge 源路径，注入 `---DELETE---` blocks，通过已有 `ApplyWikiBlocks` 路径执行删除
- 新增 lint 检查 `duplicate_page`：基于文件名归一化检测疑似重复页面
- 新增「深度整理」功能：归档对话框增加内容相似度检测开关，仅 organize 模式显示，通过 review 记录传递到 plan 执行阶段

## Capabilities

### New Capabilities

- `organize-deep-scan`: 整理归档的深度扫描功能——文件名归一化重复检测（默认启用）、内容相似度检测（开关控制）、以及 plan apply 的源文件自动清理

### Modified Capabilities

- `wiki-lint`: 新增 `duplicate_page` 检查，检测归一化文件名相同的 wiki 页面对
- `ingest-pipeline`: plan JSON schema 扩展 move/merge 字段，apply 阶段增加源文件 DELETE 清理
- `ingest-chat-ui`: 归档对话框增加深度整理 checkbox（仅 organize 模式）

## Impact

- **Go 后端**: `internal/ingest/prompts.go`（plan prompt schema）、`internal/ingest/pipeline_review.go`（apply cleanup）、`internal/engine/lint.go`（duplicate_page）、`internal/engine/entity_concept_coupling.go`（复用 normalizeNameKey）、`internal/api/ingest_session.go`（archive 请求参数）、`internal/store/sqlite/ingest_reviews.go`（review 表字段）、`internal/mcp/diagnostic_tools.go`（audit 展示）
- **前端**: `web/src/components/IngestChat.tsx`（归档对话框）、`web/src/i18n/messages/zh.ts` 和 `en.ts`（翻译键）
- **数据库**: `ingest_reviews` 表增加 `deep_organize` 布尔列
- **无破坏性变更**：现有 plan JSON 不含新字段时行为不变，DELETE blocks 仅在有明确 move/merge 动作时注入
